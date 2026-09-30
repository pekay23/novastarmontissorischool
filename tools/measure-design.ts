/**
 * Measures what the browser actually computes for the public site.
 *
 * Written because the design tokens in globals.css declare bare HSL channels
 * (`--color-primary: 107 91% 18%`), which is not a valid colour, so utilities
 * like bg-primary compile to an invalid declaration and silently render
 * nothing. Reading the source cannot catch that; reading computed styles can.
 *
 * Also reports contrast ratios, so text that is technically rendered but
 * unreadable is caught the same way.
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PAGES = ["/", "/about", "/academics", "/admissions", "/fees", "/news", "/events", "/contact"];

interface ColorReport {
  element: string;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: number;
  contrast: number | null;
}

/**
 * Converts any CSS colour to sRGB using the browser itself, via a 1x1 canvas.
 *
 * Hand-rolled Lab-to-sRGB matrices are easy to get subtly wrong (D50 vs D65
 * adaptation), and a wrong ratio produces a confident but false accessibility
 * verdict. Tailwind v4 also emits oklch()/lab() rather than rgb(), so there is
 * no rgb() string left to parse. Letting the engine normalise is both simpler
 * and correct.
 */
const CONVERTER = `
  window.__toSrgb = (color) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillStyle = color;
    // A fully transparent colour leaves the pixel at 0,0,0,0.
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
`;

async function installConverter(page: import("@playwright/test").Page) {
  await page.addInitScript(CONVERTER);
}

// Relative luminance and the ratio are computed in-page, in Node-free browser
// context, so the numbers come from the same engine that renders the pixels.
const LUMINANCE_AND_CONTRAST = `
  window.__contrast = (fg, bg) => {
    const a = window.__toSrgb(fg);
    const b = window.__toSrgb(bg);
    if (!a || !b) return null;
    // A fully transparent background cannot carry a meaningful ratio.
    if (b[3] === 0) return null;
    const lum = ([r, g, bl]) => {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
    };
    const l1 = lum(a);
    const l2 = lum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
`;

const CONVERTER = `
  window.__toSrgb = (color) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillStyle = color;
    // A fully transparent colour leaves the pixel at 0,0,0,0.
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  };
`;

async function installConverter(page: import("@playwright/test").Page) {
  await page.addInitScript(CONVERTER);
  await page.addInitScript(LUMINANCE_AND_CONTRAST);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log(`Measuring ${BASE}\n${"=".repeat(70)}`);

  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const names = [
      "--color-primary", "--color-secondary", "--color-accent",
      "--color-background", "--color-foreground", "--color-border", "--color-muted",
    ];
    const out: Record<string, string> = {};
    for (const n of names) {
      const v = cs.getPropertyValue(n).trim();
      // A bare "H S% L%" is not a usable colour; hsl(var(--x)) would need it wrapped.
      out[n] = v ? (/^[\d.]+ [\d.]+% [\d.]+%$/.test(v) ? `${v}   <-- BARE HSL, INVALID AS A COLOUR` : v) : "(undefined)";
    }
    return out;
  });
  void tokens;

  await page.goto(BASE, { waitUntil: "networkidle" });
  const t = await page.evaluate(() => {    const cs = getComputedStyle(document.documentElement);
    const names = [
      "--color-primary", "--color-secondary", "--color-accent",
      "--color-background", "--color-foreground", "--color-border", "--color-muted",
    ];
    const out: Record<string, string> = {};
    for (const n of names) {
      const v = cs.getPropertyValue(n).trim();
      out[n] = v ? (/^[\d.]+ [\d.]+% [\d.]+%$/.test(v) ? `${v}  <-- BARE HSL, INVALID` : v) : "(undefined)";
    }
    return out;
  });
  console.log("DESIGN TOKENS as computed:");
  for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(22)} ${v}`);

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const data: ColorReport[] = await page.evaluate(() => {
      const pick = (sel: string) => document.querySelector(sel) as HTMLElement | null;
      const info = (el: HTMLElement | null, name: string) => {
        if (!el) return { element: name, color: "(missing)", background: "", fontFamily: "", fontSize: 0, contrast: null };
        const cs = getComputedStyle(el);
        let bgNode: HTMLElement | null = el;
        let bg = "rgba(0, 0, 0, 0)";
        while (bgNode) {
          const b = getComputedStyle(bgNode).backgroundColor;
          if (b && b !== "rgba(0, 0, 0, 0)" && !b.startsWith("rgba(0, 0, 0, 0)")) { bg = b; break; }
          bgNode = bgNode.parentElement;
        }
        return {
          element: name,
          color: cs.color,
          background: bg,
          fontFamily: cs.fontFamily,
          fontSize: parseFloat(cs.fontSize),
          contrast: window.__contrast(cs.color, bg),
        };
      };
      return [
        info(pick("body"), "body"),
        info(pick("h1"), "h1"),
        info(pick("h2"), "h2"),
        info(pick("header a[href='/'] span"), "logo text"),
        info(pick("header nav a"), "nav link"),
        info(pick("main p"), "body copy"),
      ];
    });

    console.log(`\n--- ${path} ---`);
    for (const d of data) {
      const c = contrast(d.color, d.background);
      const font = d.fontFamily.split(",")[0].replace(/["']/g, "");
      const flag =
        c !== null && c < 4.5 && d.fontSize < 24 ? "  <-- CONTRAST BELOW 4.5:1" : "";
      console.log(`  ${d.element.padEnd(14)} ${d.color.padEnd(20)} on ${d.background.padEnd(20)} ${String(d.fontSize).padStart(5)}px  ${font}${flag}`);
    }
  }

  // Fonts actually loaded
  await page.goto(BASE, { waitUntil: "networkidle" });
  const fonts = await page.evaluate(() =>
    Array.from(document.fonts).map((f) => `${f.family} ${f.weight} ${f.status}`),
  );
  console.log(`\nLOADED @font-face / FontFaceSet entries: ${fonts.length}`);
  for (const f of fonts.slice(0, 12)) console.log(`  ${f}`);
  if (fonts.length === 0) console.log("  NONE — the typefaces named in globals.css are never loaded, so every heading falls back to a generic serif");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
