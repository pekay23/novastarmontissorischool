import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

function previewPassword(): string | undefined {
  if (process.env.E2E_PREVIEW_PASSWORD) return process.env.E2E_PREVIEW_PASSWORD;
  if (process.env.CI) return undefined;
  try {
    return readFileSync("apps/web/.env.local", "utf8")
      .match(/^MARKETING_PREVIEW_PASSWORD=(.+)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "");
  } catch {
    return undefined;
  }
}

test("preview sign-in persists across full navigations without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const password = previewPassword();
  test.skip(!password, "Set E2E_PREVIEW_PASSWORD to exercise preview access.");
  if (!password) return;
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  try {
    const page = await context.newPage();
    await page.goto("/school-preview/");
    await page.getByLabel("Preview password").fill(password);
    await page.getByRole("button", { name: "Step inside" }).click();
    await expect(
      page.getByRole("button", { name: "Lock preview" }),
    ).toBeVisible();
    for (const path of ["about", "academics", "fees", "visit"]) {
      await page.goto(`/school-preview/${path}`);
      await expect(
        page.getByRole("button", { name: "Lock preview" }),
      ).toBeVisible();
      await expect(page.getByLabel("Preview password")).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

test("preview refuses the confirmation request when the browser has no cookie", async ({
  page,
  request,
  baseURL,
}) => {
  const password = previewPassword();
  test.skip(!password, "Set E2E_PREVIEW_PASSWORD to exercise preview access.");
  if (!password || !baseURL) return;
  const response = await request.post("/school-preview/access/", {
    headers: { origin: new URL(baseURL).origin },
    form: { action: "unlock", password },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["set-cookie"]).toContain(
    "novastar-design-preview-v2=",
  );
  await page.goto(response.headers().location);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "did not retain preview access" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock preview" })).toHaveCount(
    0,
  );
});

test("private marketing redesign works across its pages and family journeys", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(240_000);
  const password = previewPassword();
  test.skip(
    !password,
    "Set E2E_PREVIEW_PASSWORD to exercise the protected design preview.",
  );
  if (!password) return;

  await page.setViewportSize({ width: 1440, height: 1000 });
  await test.step("direct links and invalid cookies cannot reveal the preview", async () => {
    await context.addCookies([
      {
        name: "novastar-design-preview-v2",
        value: "invalid-session",
        domain: new URL(testInfo.project.use.baseURL ?? "http://localhost:3000")
          .hostname,
        path: "/school-preview",
      },
    ]);
    const response = await page.goto("/school-preview/fees/");
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.getByLabel("Preview password")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "The details matter. Let’s make them clear.",
      }),
    ).toHaveCount(0);
    await page
      .getByLabel("Preview password")
      .fill("deliberately-wrong-password");
    await page.getByRole("button", { name: "Step inside" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "password did not match" }),
    ).toBeVisible();
  });

  await test.step("unlock and inspect desktop design", async () => {
    await page.getByLabel("Preview password").fill(password);
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/school-preview/access/"),
    );
    await page.getByRole("button", { name: "Step inside" }).click();
    const signInResponse = await submitted;
    expect(signInResponse.status()).toBe(303);
    const signInHeaders = await signInResponse.allHeaders();
    expect(signInHeaders["set-cookie"]).toContain(
      "novastar-design-preview-v2=",
    );
    expect(signInHeaders["set-cookie"]).toContain("Path=/;");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Room to wonder.Space to become.",
    );
    const session = (await context.cookies()).find(
      (cookie) =>
        cookie.name === "novastar-design-preview-v2" && cookie.path === "/",
    );
    expect(session?.httpOnly).toBe(true);
    expect(session?.path).toBe("/");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await page.locator(".ns-home-photo img").evaluate(async (element) => {
      if (element instanceof HTMLImageElement) await element.decode();
    });
    await page.screenshot({
      path: testInfo.outputPath("redesign-desktop.png"),
    });
    await page
      .getByLabel("Where is your child in their journey?")
      .selectOption("primary-school");
    await expect(page.locator(".ns-finder-result")).toContainText(
      "The primary years",
    );
  });

  await test.step("page links, reload and history preserve the unlocked session", async () => {
    await context.addCookies([
      {
        name: "novastar-design-preview-v2",
        value: "stale-page-session",
        domain: new URL(testInfo.project.use.baseURL ?? "http://localhost:3000")
          .hostname,
        path: "/school-preview/about",
      },
    ]);
    const mainNavigation = page.getByRole("navigation", {
      name: "Preview main navigation",
      exact: true,
    });
    for (const name of [
      "Our school",
      "Learning",
      "School life",
      "Admissions",
      "Contact",
    ]) {
      await mainNavigation.getByRole("link", { name, exact: true }).click();
      if (name === "Our school") await page.screenshot({ path: testInfo.outputPath("preview-about-session.png") });
      await expect(
        page.getByRole("button", { name: "Lock preview" }),
      ).toBeVisible();
      await expect(page.getByLabel("Preview password")).toHaveCount(0);
    }
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Lock preview" }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("button", { name: "Lock preview" }),
    ).toBeVisible();
    await page.locator(".ns-navigation .ns-brand").click();
    const pin = await page.locator(".ns-footer-top > div > svg").boundingBox();
    const locationText = await page
      .locator(".ns-footer-top > div > p")
      .boundingBox();
    expect(pin).not.toBeNull();
    expect(locationText).not.toBeNull();
    if (pin && locationText) {
      expect(
        Math.abs(
          pin.x + pin.width / 2 - locationText.x - locationText.width / 2,
        ),
      ).toBeLessThan(1);
      expect(pin.y + pin.height).toBeLessThanOrEqual(locationText.y);
    }
  });

  await page
    .locator(".ns-footer-top")
    .screenshot({ path: testInfo.outputPath("redesign-footer-centered.png") });

  await test.step("every redesigned page is reachable behind the session", async () => {
    const paths = [
      "about",
      "academics",
      "preschool",
      "primary-school",
      "junior-high",
      "school-life",
      "admissions",
      "visit",
      "fees",
      "contact",
      "news",
      "events",
      "faqs",
      "search",
      "policies",
      "privacy",
      "terms",
      "accessibility",
      "nondiscrimination",
      "news/a-good-school-visit",
      "news/independence-in-small-steps",
    ];
    for (const path of paths) {
      const response = await page.request.get(`/school-preview/${path}/`);
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      expect(html, path).not.toContain('name="password"');
      expect(html, path).toContain('id="preview-main"');
    }
    expect(
      (await page.request.get("/school-preview/unknown-page/")).status(),
    ).toBe(404);
  });

  await test.step("search and mobile navigation work", async () => {
    await page.goto("/school-preview/search/");
    await page.getByLabel("What would you like to know?").fill("fees");
    await expect(
      page
        .locator(".ns-search-results")
        .getByRole("link", { name: /Fees.*practicalities/ }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/school-preview/");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.locator(".ns-home-photo img").evaluate(async (element) => {
      if (element instanceof HTMLImageElement) await element.decode();
    });
    await page.screenshot({ path: testInfo.outputPath("redesign-mobile.png") });
    await page.locator(".ns-mobile-menu > summary").click();
    await page
      .getByRole("navigation", { name: "Preview mobile navigation" })
      .getByRole("link", { name: "Admissions", exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Your next chapter",
    );
  });

  await test.step("visit enquiries prepare a draft without sending or claiming a booking", async () => {
    await page.goto("/school-preview/visit/");
    await page.getByLabel("Your name", { exact: true }).fill("Preview family");
    await page
      .getByLabel("Email address", { exact: true })
      .fill("family@example.test");
    await page
      .getByLabel("Stage of interest")
      .selectOption({ label: "Basic 1–6" });
    await page.getByLabel("Preferred visit date").fill("2027-01-20");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Prepare my enquiry" }).click();
    await expect(
      page.getByRole("heading", { name: "Your message is ready." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open email", exact: true }),
    ).toHaveAttribute("href", /^mailto:/);
    await expect(page.locator(".ns-draft")).toContainText(
      "confirmed only after the school replies",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  });

  await test.step("locking the preview removes access to deep links", async () => {
    await page.getByRole("button", { name: "Lock preview" }).click();
    await expect(page.getByLabel("Preview password")).toBeVisible();
    await page.goto("/school-preview/about/");
    await expect(page.getByLabel("Preview password")).toBeVisible();
  });
});
