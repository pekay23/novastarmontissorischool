/**
 * Browser verification for the public site.
 *
 * Visits every page at three viewports, captures a screenshot, and records
 * anything a client would notice: console errors, failed requests, broken
 * images, and rendered colours that failed to resolve.
 *
 * Usage: bun run tools/site-audit.ts [baseUrl] [outDir]
 */
import { chromium, devices, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = resolve(process.cwd(), process.argv[3] ?? "tools/audit-shots");

const PAGES = [
  { path: "/", name: "home" },
  { path: "/about", name: "about" },
  { path: "/academics", name: "academics" },
  { path: "/admissions", name: "admissions" },
  { path: "/fees", name: "fees" },
  { path: "/news", name: "news" },
  { path: "/events", name: "events" },
  { path: "/contact", name: "contact" },
];

const VIEWPORTS = [
  { key: "mobile", viewport: { width: 390, height: 844 }, device: devices["iPhone 13"] },
  { key: "tablet", viewport: { width: 820, height: 1180 }, device: {} },
  { key: "desktop", viewport: { width: 1440, height: 900 }, device: devices["Desktop Chrome"] },
];

interface Finding {
  page: string;
  viewport: string;
  severity: "error" | "warning";
  message: string;
}

const findings: Finding[] = [];

function record(page: string, viewport: string, severity: "error" | "warning", message: string) {
  findings.push({ page, viewport, severity, message });
}

/** Elements that resolved to no colour at all, which is a design-token bug. */
async function checkUnresolvedColors(page: Page) {
  return page.evaluate(() => {
    const bad: string[] = [];
    const nodes = document.querySelectorAll<HTMLElement>(
      "body, header, footer, main, section, div, h1, h2, h3, a, button, span, p",
    );
    for (const el of nodes) {
      const cs = getComputedStyle(el);
      // A transparent background on a large block is usually an unresolved token.
      if (cs.backgroundColor === "rgba(0, 0, 0, 0)" && el.offsetHeight > 80 && el.offsetWidth > 300) {
        bad.push(`transparent block: <${el.tagName.toLowerCase()} class="${el.className?.toString().slice(0, 60)}">`);
      }
      if (bad.length > 6) break;
    }
    return bad;
  });
}

async function auditPage(context: BrowserContext, pageDef: { path: string; name: string }, vp: string) {
  const page = await context.newPage();
  const errors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message.slice(0, 300)}`));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (!url.startsWith("data:")) failedRequests.push(`${url.slice(0, 120)} ${req.failure()?.errorText ?? ""}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url().slice(0, 120)}`);
  });

  const url = `${BASE}${pageDef.path}`;
  try {
    // Not `networkidle`: `/contact/` embeds a Google Maps iframe, so the network
    // never goes idle within any useful timeout and this reports a navigation
    // failure for a page that loaded fine. `domcontentloaded` plus a short settle
    // is what the audit actually needs. See `gotoMeasurable` in
    // tools/ui-audit/shared.mjs.
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(600);
    if (res && res.status() >= 400) {
      record(pageDef.name, vp, "error", `HTTP ${res.status()} for ${pageDef.path}`);
    }
  } catch (e) {
    record(pageDef.name, vp, "error", `navigation failed: ${(e as Error).message.slice(0, 160)}`);
    await page.close();
    return;
  }

  // Give fonts and images a moment to settle before shooting.
  await page.waitForTimeout(1200);

  const dir = resolve(OUT, vp);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${pageDef.name}.png`), fullPage: true });

  for (const e of errors) record(pageDef.name, vp, "error", e);
  for (const f of failedRequests) record(pageDef.name, vp, "error", f);

  // Broken images.
  //
  // This used to be `!i.complete || i.naturalWidth === 0`, and the `naturalWidth`
  // half was dismissed as a false positive: it reported the site logo as broken on
  // every route, `logo.svg` served 200, and the claim was assumed to be an SVG
  // intrinsic-size quirk.
  //
  // It was not. The logo was genuinely broken — invalid XML, because its comment
  // spelled CSS custom property names and an XML comment cannot contain a double
  // hyphen — so Chromium refused to parse it. `naturalWidth: 0` was the only
  // honest signal in the entire run, and overriding it silenced the one true
  // finding. Rewriting a detector because its output is inconvenient is how a
  // broken logo ships.
  //
  // `img.decode()` is the right test because it separates the two cases that
  // `naturalWidth` conflates: it rejects when the bytes are not a decodable image,
  // and resolves for a valid SVG that simply has no intrinsic size. A painted-
  // nothing image is caught by `apps/public-site/e2e/design.spec.ts`, which also
  // checks ink coverage.
  const brokenImages = await page.evaluate(async () => {
    const out: string[] = [];
    for (const i of Array.from(document.images)) {
      const src = i.currentSrc || i.src || "(no src)";
      try {
        if ("decode" in i) await i.decode();
        else if (!i.complete) out.push(`${src} never finished loading`);
      } catch {
        const r = i.getBoundingClientRect();
        out.push(`${src} failed to decode (rendered ${Math.round(r.width)}x${Math.round(r.height)}, natural ${i.naturalWidth}x${i.naturalHeight})`);
      }
    }
    return out;
  });
  for (const b of brokenImages) record(pageDef.name, vp, "error", `broken image: ${b}`);

  // Unresolved design tokens
  const badColors = await checkUnresolvedColors(page);
  for (const b of badColors) record(pageDef.name, vp, "warning", b);

  // Accessibility basics that a client would notice
  const a11y = await page.evaluate(() => {
    const out: string[] = [];
    if (document.querySelectorAll("h1").length === 0) out.push("no <h1> on page");
    if (document.querySelectorAll("h1").length > 1) out.push(`${document.querySelectorAll("h1").length} <h1> elements`);
    const html = document.documentElement;
    if (!html.lang) out.push("<html> has no lang attribute");
    if (!document.title) out.push("empty <title>");
    const imgNoAlt = Array.from(document.images).filter((i) => !i.hasAttribute("alt")).length;
    if (imgNoAlt) out.push(`${imgNoAlt} image(s) without alt`);
    const btnNoName = Array.from(document.querySelectorAll("button")).filter(
      (b) => !b.textContent?.trim() && !b.getAttribute("aria-label"),
    ).length;
    if (btnNoName) out.push(`${btnNoName} button(s) with no accessible name`);
    return out;
  });
  for (const a of a11y) record(pageDef.name, vp, "warning", a);

  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  console.log(`Auditing ${BASE}`);

  for (const vp of VIEWPORTS) {
    console.log(`\n--- ${vp.key} (${vp.viewport.width}x${vp.viewport.height}) ---`);
    const context = await browser.newContext({ ...vp.device, viewport: vp.viewport });
    for (const p of PAGES) {
      process.stdout.write(`  ${p.name} ... `);
      const before = findings.length;
      await auditPage(context, p, vp.key);
      const added = findings.filter((f) => f.page === p.name && f.viewport === vp.key);
      console.log(added.length === 0 ? "ok" : `${added.length} finding(s)`);
      void before;
    }
    await context.close();
  }
  await browser.close();

  const byPage = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byPage.get(f.page) ?? [];
    list.push(f);
    byPage.set(f.page, list);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`FINDINGS: ${findings.length} (${findings.filter((f) => f.severity === "error").length} error, ${findings.filter((f) => f.severity === "warning").length} warning)`);
  for (const [page, list] of byPage) {
    console.log(`\n${page}:`);
    for (const f of list) console.log(`  [${f.severity}] (${f.viewport}) ${f.message}`);
  }

  writeFileSync(resolve(OUT, "findings.json"), JSON.stringify(findings, null, 2));
  console.log(`\nScreenshots: ${OUT}`);
  console.log(`Report: ${resolve(OUT, "findings.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
