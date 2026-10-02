#!/usr/bin/env node
/**
 * Build static HTML for every markdown file under `docs/`.
 *
 * Output: `docs/html/<section>/<slug>.html` mirroring the MD source tree,
 *         plus a top-level `docs/html/index.html` linking everything.
 *
 * Design language: see .claude/skills/html-effectiveness/SKILL.md
 *  - Editorial typography (Inter 500, generous whitespace)
 *  - Warm palette (clay #D97757 + ivory/oat + slate)
 *  - Numbered sections, KPI cards, status pills, callouts
 *  - Auto TOC sidebar for any doc with 3+ <h2> headings
 *  - Honours prefers-color-scheme: dark
 *
 * Hand-authored HTML files already inside `docs/html/` are preserved
 * (e.g. designer mockups). Only markdown sources get converted here.
 *
 * Run with: `bun run docs:html`
 */

import { promises as fs, existsSync, readFileSync as fsSyncReadFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DOCS = path.join(ROOT, 'docs')
const OUT = path.join(DOCS, 'html')
// ── Design tokens ─────────────────────────────────────────────────────────
// Embedded so this script is self-contained and runs in any repo with no setup.
// A project-local file always wins over the embedded copy, so a repo that has
// customised its tokens keeps them.
//
// Deliberately NOT a source: docs/html/design-tokens.css. That path is this
// script's own output, so reading it would make the file feed on itself — the
// tokens would be frozen at whatever they happened to be, and the embedded
// default would be unreachable. To customise, drop the file at
// scripts/design-tokens.css (tier 2 below).
const EMBEDDED_TOKENS = `/*
 * HTML Effectiveness — Design Tokens
 *
 * Drop this into the <head> of any HTML document, or paste the :root block
 * into your project stylesheet. Tokens follow the Acme design system from
 * thariqs.github.io/html-effectiveness.
 *
 * Conventions:
 *   - All tokens are CSS variables on :root
 *   - Light mode only — the editorial palette doesn't invert cleanly
 *   - Type scale is named (display, h1, h2, body, small, caption) — never use raw px in components
 */

:root {
  /* ── Palette ────────────────────────────────────────────────────────── */
  --clay: #D97757;
  --clay-soft: #E8A584;
  --slate: #141413;
  --ivory: #FAF9F5;
  --oat: #E3DACC;

  --white: #FFFFFF;
  --gray-100: #F0EEE6;
  --gray-300: #D1CFC5;
  --gray-500: #87867F;
  --gray-700: #3D3D3A;

  /* Semantic — use sparingly, one pill per row */
  --success: #788C5D;
  --warning: #C78E3F;
  --danger:  #B04A4A;
  --info:    #5C7CA3;

  /* Semantic surfaces (background tints for callouts/pills) */
  --success-soft: #EAEFE0;
  --warning-soft: #F5E9D2;
  --danger-soft:  #F1DEDE;
  --info-soft:    #DCE5F0;

  /* ── Surfaces (light mode default) ─────────────────────────────────── */
  --bg:        var(--ivory);
  --surface:   var(--white);
  --surface-2: var(--gray-100);
  --border:    var(--oat);
  --border-strong: var(--gray-300);

  /* ── Text ──────────────────────────────────────────────────────────── */
  --fg:        var(--slate);
  --fg-muted:  var(--gray-500);
  --fg-strong: var(--slate);
  --link:      var(--clay);

  /* ── Type scale ────────────────────────────────────────────────────── */
  --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
               Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas,
               "Liberation Mono", monospace;
  --font-serif: ui-serif, Georgia, "Iowan Old Style", "Apple Garamond", serif;

  /* Each step bundles size / weight / line-height */
  --t-display-size: 48px;
  --t-display-weight: 500;
  --t-display-lh: 1.1;

  --t-h1-size: 32px;
  --t-h1-weight: 500;
  --t-h1-lh: 1.2;

  --t-h2-size: 24px;
  --t-h2-weight: 500;
  --t-h2-lh: 1.3;

  --t-h3-size: 18px;
  --t-h3-weight: 500;
  --t-h3-lh: 1.35;

  --t-body-size: 16px;
  --t-body-weight: 430;
  --t-body-lh: 1.55;

  --t-small-size: 14px;
  --t-small-weight: 430;
  --t-small-lh: 1.5;

  --t-caption-size: 12px;
  --t-caption-weight: 500;
  --t-caption-lh: 1.4;
  --t-caption-tracking: 0.08em;

  /* ── Spacing scale ─────────────────────────────────────────────────── */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --sp-7: 48px;
  --sp-8: 64px;

  /* ── Border radius ─────────────────────────────────────────────────── */
  --r-xs: 4px;
  --r-sm: 8px;
  --r-md: 12px;
  --r-lg: 20px;
  --r-pill: 999px;

  /* ── Shadow (subtle; document-style, not card-style) ───────────────── */
  --shadow-sm: 0 1px 2px rgba(20, 20, 19, 0.06);
  --shadow-md: 0 4px 10px rgba(20, 20, 19, 0.08);
  --shadow-lg: 0 12px 28px rgba(20, 20, 19, 0.12);

  /* ── Layout ────────────────────────────────────────────────────────── */
  --col-narrow: 720px;
  --col-default: 880px;
  --col-wide: 1080px;
}

/* Light mode only — intentionally no @media (prefers-color-scheme: dark) block.
 * The editorial palette is designed to look right on ivory; the warm clay
 * accent and oat borders lose their character when inverted. */

/* ── Base document type ───────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--t-body-size);
  font-weight: var(--t-body-weight);
  line-height: var(--t-body-lh);
  font-feature-settings: "ss01" on, "cv11" on;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4 { color: var(--fg-strong); letter-spacing: -0.01em; margin: 0; }
h1 { font-size: var(--t-h1-size); font-weight: var(--t-h1-weight); line-height: var(--t-h1-lh); }
h2 { font-size: var(--t-h2-size); font-weight: var(--t-h2-weight); line-height: var(--t-h2-lh); }
h3 { font-size: var(--t-h3-size); font-weight: var(--t-h3-weight); line-height: var(--t-h3-lh); }

p { margin: var(--sp-3) 0; }

a { color: var(--link); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 120ms; }
a:hover { border-bottom-color: currentColor; }

code, kbd, samp {
  font-family: var(--font-mono);
  font-size: 0.92em;
  background: var(--surface-2);
  color: var(--fg-strong);
  padding: 1px 6px;
  border-radius: var(--r-xs);
}

pre {
  font-family: var(--font-mono);
  font-size: var(--t-small-size);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: var(--sp-4) var(--sp-5);
  overflow-x: auto;
  line-height: 1.5;
}
pre code { background: transparent; padding: 0; }

blockquote {
  margin: var(--sp-5) 0;
  padding: var(--sp-4) var(--sp-5);
  background: var(--surface-2);
  border-left: 3px solid var(--clay);
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
  color: var(--fg-muted);
}

hr { border: 0; border-top: 1px solid var(--border); margin: var(--sp-6) 0; }

table { width: 100%; border-collapse: collapse; font-size: var(--t-small-size); margin: var(--sp-4) 0; }
th, td { padding: var(--sp-3) var(--sp-4); text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
th { font-weight: 500; color: var(--fg-muted); font-size: var(--t-caption-size); text-transform: uppercase; letter-spacing: var(--t-caption-tracking); background: transparent; }

ul, ol { padding-left: var(--sp-5); margin: var(--sp-3) 0; }
li { margin: var(--sp-2) 0; }

/* Selection */
::selection { background: var(--clay); color: var(--ivory); }

/* ── Layout shell ─────────────────────────────────────────────────────── */
.he-shell {
  max-width: var(--col-default);
  margin: 0 auto;
  padding: var(--sp-6) var(--sp-5) var(--sp-8);
}
.he-shell--narrow { max-width: var(--col-narrow); }
.he-shell--wide { max-width: var(--col-wide); }

/* ── Top navigation bar ──────────────────────────────────────────────── */
.he-nav {
  display: flex;
  align-items: baseline;
  gap: var(--sp-4);
  padding-bottom: var(--sp-4);
  margin-bottom: var(--sp-6);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.he-nav__brand {
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--fg-strong);
  text-decoration: none;
  border-bottom: 0;
}
.he-nav__brand:hover { border-bottom: 0; }
.he-nav__brand small { color: var(--clay); margin-left: var(--sp-2); font-weight: 500; }
.he-nav__links { margin-left: auto; display: flex; gap: var(--sp-5); font-size: var(--t-small-size); }
.he-nav__links a { color: var(--fg-muted); }
.he-nav__links a:hover { color: var(--fg-strong); border-bottom-color: var(--fg-strong); }

/* ── Document header ─────────────────────────────────────────────────── */
.he-eyebrow {
  font-size: var(--t-caption-size);
  font-weight: var(--t-caption-weight);
  letter-spacing: var(--t-caption-tracking);
  text-transform: uppercase;
  color: var(--fg-muted);
  margin-bottom: var(--sp-3);
}

.he-title {
  font-size: var(--t-display-size);
  font-weight: var(--t-display-weight);
  line-height: var(--t-display-lh);
  letter-spacing: -0.02em;
  color: var(--fg-strong);
  margin: 0 0 var(--sp-3);
}

.he-deck {
  font-size: var(--t-h3-size);
  font-weight: var(--t-body-weight);
  color: var(--fg-muted);
  margin: 0 0 var(--sp-6);
  max-width: 60ch;
}

/* ── Numbered section header ─────────────────────────────────────────── */
.he-section {
  margin-top: var(--sp-7);
  padding-top: var(--sp-5);
  border-top: 1px solid var(--border);
}
.he-section__num {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: var(--t-caption-size);
  letter-spacing: 0.05em;
  color: var(--clay);
  margin-bottom: var(--sp-2);
}
.he-section__title {
  font-size: var(--t-h2-size);
  font-weight: var(--t-h2-weight);
  margin: 0 0 var(--sp-4);
}

/* ── KPI card ────────────────────────────────────────────────────────── */
.he-kpis { display: grid; gap: var(--sp-4); grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin: var(--sp-5) 0; }
.he-kpi {
  padding: var(--sp-4) var(--sp-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.he-kpi__value {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--fg-strong);
  line-height: 1.1;
}
.he-kpi__label {
  font-size: var(--t-caption-size);
  letter-spacing: var(--t-caption-tracking);
  text-transform: uppercase;
  color: var(--fg-muted);
  margin-top: var(--sp-2);
}
.he-kpi__delta { font-size: var(--t-small-size); color: var(--fg-muted); margin-top: var(--sp-1); }
.he-kpi__delta--up { color: var(--success); }
.he-kpi__delta--down { color: var(--danger); }

/* ── Pills ──────────────────────────────────────────────────────────── */
.he-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  padding: 2px 10px;
  border-radius: var(--r-pill);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1.4;
}
.he-pill--low      { background: var(--success-soft); color: var(--success); }
.he-pill--med      { background: var(--warning-soft); color: var(--warning); }
.he-pill--high     { background: var(--danger-soft);  color: var(--danger); }
.he-pill--info     { background: var(--info-soft);    color: var(--info); }
.he-pill--done     { background: var(--success-soft); color: var(--success); }
.he-pill--blocked  { background: var(--danger-soft);  color: var(--danger); }
.he-pill--review   { background: var(--info-soft);    color: var(--info); }
.he-pill--neutral  { background: var(--surface-2);    color: var(--fg-muted); }

/* ── Callouts ────────────────────────────────────────────────────────── */
.he-callout {
  padding: var(--sp-4) var(--sp-5);
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  margin: var(--sp-5) 0;
  background: var(--surface);
}
.he-callout--info    { border-left: 3px solid var(--info);    background: var(--info-soft); }
.he-callout--warning { border-left: 3px solid var(--warning); background: var(--warning-soft); }
.he-callout--danger  { border-left: 3px solid var(--danger);  background: var(--danger-soft); }
.he-callout--success { border-left: 3px solid var(--success); background: var(--success-soft); }
.he-callout__title { font-weight: 500; margin-bottom: var(--sp-1); color: var(--fg-strong); }

/* ── Inline tag (file path / flag / table name) ──────────────────────── */
.he-tag {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: transparent;
  color: var(--fg-muted);
  padding: 0;
  border-bottom: 1px dashed var(--border-strong);
}

/* ── Grid + card ─────────────────────────────────────────────────────── */
.he-grid { display: grid; gap: var(--sp-4); grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin: var(--sp-5) 0; }
.he-card {
  padding: var(--sp-4) var(--sp-5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  transition: border-color 160ms, transform 160ms;
}
.he-card:hover { border-color: var(--clay); transform: translateY(-1px); }
.he-card__eyebrow {
  font-size: var(--t-caption-size);
  letter-spacing: var(--t-caption-tracking);
  text-transform: uppercase;
  color: var(--clay);
  margin-bottom: var(--sp-2);
}
.he-card h3 { font-size: var(--t-h3-size); font-weight: 500; margin: 0 0 var(--sp-2); }
.he-card__meta { font-size: var(--t-small-size); color: var(--fg-muted); margin-top: var(--sp-3); display: flex; gap: var(--sp-3); flex-wrap: wrap; }

/* ── Footer ──────────────────────────────────────────────────────────── */
.he-foot {
  margin-top: var(--sp-7);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--border);
  font-size: var(--t-small-size);
  color: var(--fg-muted);
}

/* ── Pull-quote ──────────────────────────────────────────────────────── */
.he-pull {
  font-family: var(--font-serif);
  font-size: var(--t-h2-size);
  line-height: 1.4;
  color: var(--fg-strong);
  padding: var(--sp-5);
  margin: var(--sp-6) 0;
  border-left: 3px solid var(--clay);
}

/* ── Glossary ────────────────────────────────────────────────────────── */
.he-glossary { display: grid; grid-template-columns: max-content 1fr; gap: var(--sp-3) var(--sp-5); margin: var(--sp-5) 0; }
.he-glossary dt { font-weight: 500; color: var(--fg-strong); font-family: var(--font-mono); font-size: var(--t-small-size); padding-top: 2px; }
.he-glossary dd { margin: 0; color: var(--fg-muted); font-size: var(--t-small-size); }

/* ── Timeline ────────────────────────────────────────────────────────── */
.he-timeline { display: grid; gap: var(--sp-4); margin: var(--sp-5) 0; }
.he-timeline__item { display: grid; grid-template-columns: 100px 1fr; gap: var(--sp-5); padding-bottom: var(--sp-4); border-bottom: 1px dashed var(--border); }
.he-timeline__when { font-family: var(--font-mono); font-size: var(--t-caption-size); letter-spacing: 0.05em; color: var(--clay); text-transform: uppercase; }
.he-timeline__what h3 { margin: 0 0 var(--sp-2); font-size: var(--t-h3-size); font-weight: 500; }
.he-timeline__what p { margin: var(--sp-1) 0; color: var(--fg-muted); font-size: var(--t-small-size); }
`

const TOKEN_SOURCES = [
  path.join(ROOT, '.claude/skills/html-effectiveness/references/design-tokens.css'),
  path.join(ROOT, 'scripts/design-tokens.css'),
]

async function resolveTokens() {
  for (const p of TOKEN_SOURCES) {
    const css = await fs.readFile(p, 'utf8').catch(() => null)
    if (css && css.trim()) return { css, from: path.relative(ROOT, p).replaceAll('\\', '/') }
  }
  return { css: EMBEDDED_TOKENS, from: 'embedded default' }
}

// docs/html/ is this script's own output. Never treat it as a source dir.
const isOutputDir = (name) => path.resolve(DOCS, name) === OUT

// Record of the pages this script wrote on its last run. Lets a build tell a
// hand-authored page apart from an orphaned generated one, and lets it prune
// the page of a markdown file that was deleted or renamed. Files not in the
// manifest are never touched.
const MANIFEST = path.join(OUT, '.generated.json')

function readGeneratedManifest() {
  try {
    const raw = JSON.parse(fsSyncReadFileSync(MANIFEST, 'utf8'))
    return new Set(Array.isArray(raw.files) ? raw.files : [])
  } catch {
    return new Set()
  }
}

// Manifest membership test, case-insensitive for the same reason as
// pruneStalePages(): a stale manifest entry that differs only by case names the
// same file, so an exact-match check would classify a page this run just wrote
// as hand-authored and list it under "Standalone HTML".
function isGenerated(generated, rel) {
  const key = rel.toLowerCase()
  for (const entry of generated) if (entry.toLowerCase() === key) return true
  return false
}

// Delete pages written by a previous run that this run did not reproduce.
// Membership is compared case-insensitively: on a case-insensitive filesystem
// "Changelog.html" and "changelog.html" are the same file, so an exact-match
// check would happily delete a page this run just wrote.
async function pruneStalePages(current) {
  const previous = readGeneratedManifest()
  const currentKeys = new Set([...current].map((p) => p.toLowerCase()))
  const stale = [...previous].filter((rel) => !currentKeys.has(rel.toLowerCase()))
  for (const rel of stale) {
    await fs.rm(path.join(OUT, rel), { force: true })
  }
  return stale
}

async function writeGeneratedManifest(current) {
  await fs.writeFile(MANIFEST, `${JSON.stringify({ files: [...current].sort() }, null, 2)}\n`, 'utf8')
}

// One predicate for "is this a markdown source file", so every walk, link
// rewrite and file filter agrees. Windows filesystems are case-insensitive, and
// `docs/NOTES.MD` is a legitimate authoring choice.
const isMd = (name) => name.toLowerCase().endsWith('.md')

// Section metadata — titles for the index page.
// Directories listed here appear first (in this order) on the index.
// Sections not listed here are auto-discovered with humanized titles.
const SECTION_META = {
  'architecture':  { title: 'Architecture' },
  'audit-reports': { title: 'Audit Reports' },
  'business':      { title: 'Business' },
  'technical':     { title: 'Technical' },
  'adr':           { title: 'ADRs' },
  'api':           { title: 'API' },
  'wireframes':    { title: 'Wireframes' },
  'guides':        { title: 'Guides' },
  'compliance':    { title: 'Compliance' },
  'plans':         { title: 'Plans' },
  'design':        { title: 'Design' },
  'operations':    { title: 'Operations' },
}

// ── HTML helpers ─────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// href/src values are URL components, not prose. Percent-encode everything
// outside the RFC 3986 unreserved+separator set so the value is unambiguous in
// an HTML attribute — notably "&", which must NOT become the entity "&amp;"
// (that would decode back to a literal "&" and miss files whose names contain
// a literal "&amp;", as the hand-authored docs/html/ui/ pages do).
function escapeHref(s) {
  return String(s)
    .replace(/%/g, '%25')
    .replace(/[^A-Za-z0-9\-_.~/]/g, (c) => encodeURIComponent(c))
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function relativeHref(from, to) {
  const fromDir = path.dirname(from)
  return path.relative(fromDir, to).replaceAll('\\', '/')
}

// ── Section discovery ──────────────────────────────────────────────────────
// Build the ordered list of sections: known sections first, then any
// auto-discovered directories containing markdown.
async function discoverSections() {
  const known = Object.keys(SECTION_META)
  const result = []

  for (const dir of known) {
    const fullPath = path.join(DOCS, dir)
    if (await dirHasMd(fullPath)) {
      result.push({ dir, ...SECTION_META[dir] })
    }
  }

  // Auto-discover any directories not in SECTION_META that contain .md files
  const entries = await fs.readdir(DOCS, { withFileTypes: true }).catch(() => [])
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    if (isOutputDir(path.join(DOCS, ent.name))) continue
    // Case-insensitive so `docs/ADR/` is not picked up a second time as an
    // unknown section alongside the known 'adr' section — same directory on a
    // case-insensitive filesystem, and it would otherwise be rendered twice
    // with two different output paths in the manifest.
    if (known.some((k) => k.toLowerCase() === ent.name.toLowerCase())) continue
    const fullPath = path.join(DOCS, ent.name)
    if (await dirHasMd(fullPath)) {
      result.push({ dir: ent.name, title: humanize(ent.name) })
    }
  }

  return result
}

// ── Root-level markdown ───────────────────────────────────────────────────
// `docs/*.md` (e.g. docs/README.md) sits outside every section directory, so
// the section walk never sees it. Build those into docs/html/<slug>.html and
// surface them on the index under "Top-level".
async function findRootDocs() {
  const entries = await fs.readdir(DOCS, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((ent) => ent.isFile() && isMd(ent.name))
    .map((ent) => ent.name)
    // docs/index.md would become docs/html/index.html, which the generated
    // index owns. Skip it rather than silently discarding the author's page.
    .filter((name) => !/^index\.md$/i.test(name))
    .sort()
}

// Strip inline markdown markers so titles read as prose rather than leaking
// backticks/asterisks from headings like "# Build Plan — `apps/super-admin`".
function cleanTitle(text) {
  return String(text)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    // Single-asterisk emphasis only when the span is neither arithmetic
    // ("3 * 5 * 7") nor a bare number ("* 3 total"), so those titles survive.
    .replace(/(^|[\s(])\*([^*\n]*[A-Za-z][^*\n]*)\*/g, (match, pre, span) =>
      /\d\s*$|^\s*\d/.test(span) ? match : `${pre}${span}`
    )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// "visual-baseline-2026-10-01" → "Visual Baseline 2026-10-01"
// Date-like segments survive intact; only word breaks are titled. HTML entities
// are stepped over so "&amp;" never becomes "&Amp;".
function humanize(name) {
  return String(name)
    .split(/(\d{4}-\d{2}-\d{2})/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/(&[a-zA-Z]+;)|\b\w/g, (m, entity) => entity || m.toUpperCase())
    )
    .filter(Boolean)
    .join(' ')
}

// Friendly heading for a folder page: section title at the top level,
// humanized segments below it.
function folderTitleFor(relToRoot) {
  const parts = relToRoot.split('/').filter(Boolean)
  if (parts.length === 0) return 'Docs'
  if (parts.length === 1 && SECTION_META[parts[0]]) return SECTION_META[parts[0]].title
  return parts.map(humanize).join(' / ')
}

// ── Marked renderer overrides ────────────────────────────────────────────
// We extend marked to:
//   - rewrite *.md → *.html in internal links
//   - emit numbered editorial section headers (01 · Title) for top-level h2s
//   - give every h2/h3 an id for the TOC sidebar

// Rewrite markdown links to the matching .html page.
//
// Sources spell in-repo links several ways, and all of them must resolve:
//
//   "sibling.md"                  → relative to the source file's folder
//   "../adr/ADR-1.md"             → relative to the source file's folder
//   "docs/adr/ADR-022.md"         → relative to the repo root
//   "/docs/adr/ADR-022.md"        → relative to the repo root
//   "docs\adr\ADR-022.md"         → Windows separators, repo root
//
// Rather than pattern-match that list, resolve each candidate both ways and
// keep the one that is a real file inside docs/. Containment in DOCS is the
// traversal guard. Rewriting lives here (not in the body pipeline) so inline
// renders — the deck under each page title — get the same treatment.
function rewriteMdLinks(html, { srcDir, outDir } = {}) {
  return html.replace(/href="([^"#?]*\.md)((?:[#?][^"]*)?)"/gi, (match, rawFile, suffix) => {
    if (/^(?:https?:|\/\/)/i.test(rawFile)) return match

    // The markdown renderer percent-encodes backslashes in link targets, so a
    // Windows-authored "..\..\docs\adr\X.md" reaches us as "..%5C..%5Cdocs...".
    // Decode before resolving, or the target is unmatchable.
    const file = rawFile.replace(/%5C/gi, '/')

    const naive = `href="${escapeHref(file.replace(/\.md$/i, '.html'))}${suffix}"`
    if (!srcDir || !outDir) return naive

    const norm = file.replaceAll('\\', '/')
    const candidates = [path.resolve(srcDir, norm), path.join(ROOT, norm)]

    for (const absMd of candidates) {
      const relFromDocs = path.relative(DOCS, absMd)
      // Reject anything that escapes docs/ (including "../.." traversal).
      if (!relFromDocs || relFromDocs.startsWith('..') || path.isAbsolute(relFromDocs)) continue
      // Only rewrite when the markdown source actually exists. A link whose
      // target is gone is a source defect and must stay visibly broken rather
      // than silently resolving to a stale generated page.
      if (!existsSync(absMd)) continue

      const absOut = path.join(OUT, relFromDocs.replace(/\.md$/i, '.html'))
      const rel = path.relative(outDir, absOut).replaceAll('\\', '/')
      return `href="${escapeHref(rel.startsWith('.') ? rel : './' + rel)}${suffix}"`
    }

    return naive
  })
}

// Windows authors write link targets with backslashes ("](..\docs\x.md)"). The
// markdown renderer mangles those — "..\.." collapses to "...." and each
// separator becomes %5C — so normalize the destination before rendering.
//
// Fenced blocks and inline code spans are literal text: a code sample holding a
// Windows path must keep its backslashes, so those segments are skipped.
function normalizeLinkTargets(md) {
  return String(md)
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : seg.replace(/\]\(([^()\s]*)\)/g, (match, target) =>
            target.includes('\\') ? `](${target.replace(/\\/g, '/')})` : match
          )
    )
    .join('')
}

function buildMarkdownCallbacks({ srcDir, outDir } = {}) {
  let h2Counter = 0

  const escape = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  function processBodyHtml(html) {
    let out = rewriteMdLinks(html, { srcDir, outDir })

    // Convert blockquotes starting with <p><strong> to editorial pull-quotes
    out = out.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (match, content) => {
      const trimmed = content.trim()
      if (/^<p><strong>/.test(trimmed)) {
        return `<blockquote class="he-pull">${content}</blockquote>`
      }
      return match
    })

    // Wrap h2 headings in numbered editorial sections; add ids to h3+
    out = out.replace(/<h([1-6])([^>]*)>(.*?)<\/h[1-6]>/g, (match, level, attrs, content) => {
      const plain = content.replace(/<[^>]+>/g, '').trim()
      const id = slugify(plain)

      if (level === '2') {
        h2Counter += 1
        const num = String(h2Counter).padStart(2, '0')
        return `<section class="he-section" id="${id}"><div class="he-section__num">${num} · ${escape(plain)}</div><h2 class="he-section__title">${content}</h2></section>`
      }

      return `<h${level} id="${id}"${attrs}>${content}</h${level}>`
    })

    return out
  }

  return {
    resetCounter: () => {
      h2Counter = 0
    },
    render: (md) => processBodyHtml(Bun.markdown.html(normalizeLinkTargets(md))),
    renderInline: (md) => rewriteMdLinks(Bun.markdown.html(normalizeLinkTargets(md)), { srcDir, outDir }),
  }
}

// ── TOC extraction ───────────────────────────────────────────────────────
function extractToc(md) {
  const lines = md.split('\n')
  const out = []
  for (const line of lines) {
    const m = line.match(/^(##|###)\s+(.+?)\s*$/)
    if (m) {
      const depth = m[1].length // 2 or 3
      const text = m[2].replace(/^[#`*\s]+|[`*\s]+$/g, '')
      out.push({ depth, text, id: slugify(text) })
    }
  }
  return out
}

// Convert "Week 11 — Engineering Status" or first H1 to title + eyebrow.
// The deck is the first non-heading prose paragraph, rendered inline as MD
// so that emphasis and inline code survive, then trimmed to the first
// sentence to keep it from filling the screen.
function parseHeader(md, slug) {
  const h1Match = md.match(/^#\s+(.+)$/m)
  const title = h1Match ? cleanTitle(h1Match[1]) : slug
  const afterH1 = h1Match ? md.slice((h1Match.index ?? 0) + h1Match[0].length) : md
  const paragraphs = afterH1.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const deckCandidate = paragraphs.find(
    (p) => !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('|') && !p.startsWith('- ') && !p.startsWith('> ') && !/^\d+\.\s/.test(p)
  )
  let deckMarkdown = ''
  if (deckCandidate) {
    const oneLine = deckCandidate.replace(/\s+/g, ' ')
    // Strip leading list marker before sentence extraction to avoid matching
    // "1." / "2." as a sentence end.
    const withoutListMarker = oneLine.replace(/^(\d+\.\s|[-*]\s)/, '')
    const sentenceEnd = withoutListMarker.match(/^([^.!?`]+(?:`[^`]*`[^.!?`]*)*[.!?])(?=\s|$)/)
    if (sentenceEnd) {
      deckMarkdown = sentenceEnd[1]
    } else {
      // No sentence end — trim to ~240 chars at the last word boundary
      // and don't break a markdown link/code-span.
      let slice = oneLine.slice(0, 240)
      // If we cut inside a `[...]( )` link or `` `code` ``, walk back.
      const lastOpenBracket = slice.lastIndexOf('[')
      const lastCloseParen = slice.lastIndexOf(')')
      if (lastOpenBracket > lastCloseParen) slice = slice.slice(0, lastOpenBracket).trimEnd()
      const lastTick = slice.lastIndexOf('`')
      if (lastTick > -1 && (slice.match(/`/g) || []).length % 2 === 1) {
        slice = slice.slice(0, lastTick).trimEnd()
      }
      // Final word-boundary trim
      const lastSpace = slice.lastIndexOf(' ')
      if (lastSpace > 200) slice = slice.slice(0, lastSpace)
      deckMarkdown = slice.replace(/[,:;\s]+$/, '') + '…'
    }
  }
  return { title, deckMarkdown }
}

// Strip the leading H1 + the deck paragraph so the body doesn't duplicate them.
// The deck paragraph is whatever sits between the H1 and the next blank line
// boundary, AS LONG AS it isn't itself a heading / code fence / list / quote.
function stripHeader(md) {
  let out = md.replace(/^#\s+[^\n]+\n+/, '')
  // Take the first chunk up to the next blank line; if it's prose, drop it.
  const m = out.match(/^([^\n]+(?:\n[^\n]+)*)\n\s*\n/)
  if (m) {
    const first = m[1].trimStart()
    if (
      !first.startsWith('#') &&
      !first.startsWith('```') &&
      !first.startsWith('|') &&
      !first.startsWith('- ') &&
      !first.startsWith('* ') &&
      !first.startsWith('> ')
    ) {
      out = out.slice(m[0].length)
    }
  }
  return out
}

// ── Directory metadata helpers ─────────────────────────────────────────────
async function getDirectChildren(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = []
  const subdirs = []
  for (const ent of entries) {
    if (ent.isFile() && isMd(ent.name)) {
      files.push(ent.name)
    } else if (ent.isDirectory()) {
      subdirs.push(ent.name)
    }
  }
  return { files: files.sort(), subdirs: subdirs.sort() }
}

async function dirHasMd(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const ent of entries) {
    if (ent.isFile() && isMd(ent.name)) return true
    if (ent.isDirectory() && await dirHasMd(path.join(dir, ent.name))) return true
  }
  return false
}

function extractDate(text) {
  const m = text.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// ── File walking ─────────────────────────────────────────────────────────
async function walkMd(dir) {
  const out = []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const ent of entries) {
    if (ent.isDirectory()) {
      // docs/html is this script's output; never descend into it.
      if (isOutputDir(path.join(dir, ent.name))) continue
      out.push(...(await walkMd(path.join(dir, ent.name))))
    } else if (isMd(ent.name)) {
      out.push(path.join(dir, ent.name))
    }
  }
  return out.sort()
}

// ── Page template ────────────────────────────────────────────────────────
function pageHtml({ title, eyebrow, deckHtml, body, toc, project, navLinks, basePathToHtml, isIndex, currentPath }) {
  const base = escapeHref(basePathToHtml)
  const nav = `
<nav class="he-nav">
  <a class="he-nav__brand" href="${base}index.html">${escapeHtml(project)} <small>docs</small></a>
  <div class="he-nav__links">
    <a href="${base}index.html">Index</a>
    ${navLinks.map((n) => `<a href="${base}${escapeHref(n.dir)}/index.html">${escapeHtml(n.title)}</a>`).join('\n    ')}
  </div>
</nav>`

  const tocHtml =
    toc && toc.length >= 3
      ? `
<aside class="he-toc" aria-label="On this page">
  <p class="he-toc__label">On this page</p>
  <ul>
    ${toc.map((t) => `<li class="he-toc__l${t.depth}"><a href="#${escapeHref(t.id)}">${escapeHtml(t.text)}</a></li>`).join('\n    ')}
  </ul>
</aside>`
      : ''

  const useTwoCol = !!tocHtml && !isIndex
  const layoutOpen = useTwoCol ? '<div class="he-layout">' : ''
  const layoutClose = useTwoCol ? '</div>' : ''
  const mainOpen = useTwoCol ? '<main class="he-main">' : '<main>'
  const mainClose = '</main>'
  const shellClass = useTwoCol ? 'he-shell he-shell--wide' : 'he-shell'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)} · ${escapeHtml(project)}</title>
<link rel="stylesheet" href="${escapeHref(relativeHref(currentPath, path.join(OUT, 'design-tokens.css')))}">
<link rel="stylesheet" href="${escapeHref(relativeHref(currentPath, path.join(OUT, 'docs.css')))}">
</head>
<body>
<div class="${shellClass}">
${nav}
${layoutOpen}
${mainOpen}
<header>
  <p class="he-eyebrow">${escapeHtml(eyebrow)}</p>
  <h1 class="he-title">${escapeHtml(title)}</h1>
  ${deckHtml ? `<p class="he-deck">${deckHtml}</p>` : ''}
</header>
${body}
${mainClose}
${tocHtml}
${layoutClose}
<footer class="he-foot">
  Source · <a href="${escapeHref(relativeHref(currentPath, DOCS))}">browse the markdown</a> · rebuild with <code>bun run docs:html</code>
</footer>
</div>
</body>
</html>
`
}

// ── Extra CSS for the doc site (TOC + index grid) ────────────────────────
const SITE_CSS = `/* TOC sidebar + index grid extensions to the base tokens. */

/* Full-width docs shell.
   design-tokens.css caps the shell at --col-default (880px) / --col-wide (1080px).
   docs.css is linked after it, so these rules win. Horizontal padding is kept so
   text never sits flush against the viewport edge. */
.he-shell,
.he-shell--narrow,
.he-shell--wide {
  max-width: none;
  padding-left: clamp(var(--sp-5), 4vw, var(--sp-8));
  padding-right: clamp(var(--sp-5), 4vw, var(--sp-8));
}

.he-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--sp-6);
}
@media (min-width: 1024px) {
  .he-layout {
    grid-template-columns: 1fr 220px;
  }
}

.he-main { min-width: 0; }

.he-toc {
  position: sticky;
  top: var(--sp-5);
  align-self: start;
  padding: var(--sp-4) 0 var(--sp-4) var(--sp-4);
  border-left: 1px solid var(--border);
  font-size: var(--t-small-size);
  max-height: calc(100vh - var(--sp-7));
  overflow-y: auto;
}
.he-toc__label {
  font-size: var(--t-caption-size);
  letter-spacing: var(--t-caption-tracking);
  text-transform: uppercase;
  color: var(--fg-muted);
  margin: 0 0 var(--sp-3);
}
.he-toc ul { list-style: none; padding: 0; margin: 0; }
.he-toc li { margin: var(--sp-2) 0; }
.he-toc__l3 { padding-left: var(--sp-3); }
.he-toc a { color: var(--fg-muted); border: 0; }
.he-toc a:hover { color: var(--clay); }

/* Index page: section heading + link list */
.he-index-summary { color: var(--fg-muted); font-size: var(--t-small-size); margin: 0 0 var(--sp-5); }
.he-index-section { margin-top: var(--sp-6); }
.he-index-section__title {
  margin: 0 0 var(--sp-2);
  font-size: var(--t-h3-size);
  font-weight: 500;
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}
.he-index-section__title a { color: inherit; text-decoration: none; }
.he-index-section__title a:hover { color: var(--clay); }

/* Compact title-only link list, shared by the root index and folder indexes */
.he-linklist { list-style: none; margin: 0; padding: 0; }
.he-linklist--folders { margin-bottom: var(--sp-5); }
.he-linklist__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--border);
}
.he-linklist__link { color: inherit; text-decoration: none; }
.he-linklist__link:hover { color: var(--clay); text-decoration: underline; }
.he-linklist__meta {
  flex: none;
  font-size: var(--t-caption-size);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

/* Folder pages */
.he-bc { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin: var(--sp-4) 0; font-size: var(--t-small-size); }
.he-bc__item { color: var(--fg-muted); text-decoration: none; }
.he-bc__item:hover { color: var(--clay); text-decoration: underline; }
.he-bc__sep { color: var(--border); }

.he-folder-controls {
  display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4);
}
.he-folder-controls label { font-size: var(--t-small-size); color: var(--fg-muted); font-weight: 500; }
.he-sort-select {
  padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md); border: 1px solid var(--border);
  background: var(--surface); color: inherit; font-size: var(--t-small-size);
}

.he-empty { color: var(--fg-muted); padding: var(--sp-5) 0; }
`

// ── Build one MD file ────────────────────────────────────────────────────
async function buildPage({ src, outPath, section, project, navLinks }) {
  const md = await fs.readFile(src, 'utf8')
  const { title, deckMarkdown } = parseHeader(md, path.basename(src, '.md'))
  const toc = extractToc(md)
  const stripped = stripHeader(md)

  const { render, renderInline, resetCounter } = buildMarkdownCallbacks({
    srcDir: path.dirname(src),
    outDir: path.dirname(outPath),
  })
  resetCounter()
  const body = render(stripped)
  const rawDeckHtml = deckMarkdown ? renderInline(deckMarkdown) : ''
  // Unwrap single-paragraph decks so the deck <p class="he-deck"> wrapper
  // in the template doesn't create invalid nested <p><p>…</p></p>.
  const deckHtml = rawDeckHtml && /^<p[\s>]/.test(rawDeckHtml) && /<\/p>\s*$/.test(rawDeckHtml)
    ? rawDeckHtml.replace(/^<p[\s>]*/, '').replace(/<\/p>\s*$/, '')
    : rawDeckHtml

  const folderDepth = path.relative(OUT, path.dirname(outPath)).split(path.sep).filter(Boolean).length
  const basePathToHtml = folderDepth <= 0 ? './' : '../'.repeat(folderDepth)

  const html = pageHtml({
    title,
    eyebrow: section.title,
    deckHtml,
    body,
    toc,
    project,
    navLinks,
    basePathToHtml,
    currentPath: outPath,
    isIndex: false,
  })

  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, html, 'utf8')
  return {
    // Path relative to docs/html/ with forward slashes, e.g.
    // "audit-reports/visual-baseline-2026-10-01/README". Using the basename
    // here broke index hrefs for any doc nested in a subfolder.
    slug: path.relative(OUT, outPath).replaceAll('\\', '/').replace(/\.html$/, ''),
    title,
  }
}

// ── Build a folder index page ──────────────────────────────────────────────
async function buildFolderPage({ srcDir, outDir, project, navLinks }) {
  const { files: directFiles, subdirs } = await getDirectChildren(srcDir)
  const subdirEntries = []
  for (const sd of subdirs) {
    const fullSubdir = path.join(srcDir, sd)
    if (await dirHasMd(fullSubdir)) {
      const mdCount = (await walkMd(fullSubdir)).length
      subdirEntries.push({ name: sd, count: mdCount })
    }
  }

  const fileEntries = []
  for (const f of directFiles) {
    const src = path.join(srcDir, f)
    const md = await fs.readFile(src, 'utf8')
    const { title } = parseHeader(md, f.replace(/\.md$/i, ''))
    const stat = await fs.stat(src).catch(() => null)
    const mtime = stat ? stat.mtime.toISOString().slice(0, 10) : ''
    const date = extractDate(f) || mtime
    fileEntries.push({
      title,
      date,
      href: path
        .relative(outDir, path.join(outDir, path.relative(srcDir, src).replace(/\.md$/i, '.html')))
        .replaceAll('\\', '/'),
    })
  }

  // Sort files by date descending by default
  fileEntries.sort((a, b) => {
    const cmp = (b.date || '').localeCompare(a.date || '')
    return cmp !== 0 ? cmp : a.title.localeCompare(b.title)
  })

  // Compute breadcrumbs from the folder's position in the docs tree
  const relToRoot = path.relative(DOCS, srcDir).replaceAll('\\', '/')
  const parts = relToRoot.split('/').filter(Boolean)
  const folderTitle = folderTitleFor(relToRoot)
  const folderPagePath = path.join(outDir, 'index.html')
  const folderDepth = path.relative(OUT, outDir).split(path.sep).filter(Boolean).length
  const basePathToHtml = folderDepth <= 0 ? './' : '../'.repeat(folderDepth)
  const breadcrumbItems = [{ label: 'Docs', href: relativeHref(folderPagePath, path.join(OUT, 'index.html')) }]
  for (let i = 0; i < parts.length; i++) {
    const ancestorRel = parts.slice(0, i + 1).join('/')
    const ancestorPath = path.join(OUT, ...parts.slice(0, i + 1), 'index.html')
    // Use folderTitleFor so the crumb matches that folder's own <h1> — otherwise
    // a section like "adr" reads "Adr" in the crumb but "ADRs" in the title.
    breadcrumbItems.push({ label: folderTitleFor(ancestorRel), href: relativeHref(folderPagePath, ancestorPath) })
  }
  const breadcrumbHtml = breadcrumbItems
    .map((bc, i) => {
      const isLast = i === breadcrumbItems.length - 1
      if (isLast) return `<span class="he-bc__item">${escapeHtml(bc.label)}</span>`
      return `<a class="he-bc__item" href="${escapeHref(bc.href)}">${escapeHtml(bc.label)}</a>`
    })
    .join('<span class="he-bc__sep">/</span>')

  const subdirsHtml = subdirEntries.length > 0
    ? `
  <ul class="he-linklist he-linklist--folders">
    ${subdirEntries.map((sd) => `
    <li class="he-linklist__row">
      <a class="he-linklist__link" href="${escapeHref(sd.name)}/index.html">${escapeHtml(folderTitleFor(relToRoot ? `${relToRoot}/${sd.name}` : sd.name))}</a>
      <span class="he-linklist__meta">${sd.count} doc${sd.count === 1 ? '' : 's'}</span>
    </li>`).join('')}
  </ul>`
    : ''

  // Compact list of document titles only. Dates stay (they drive the sort
  // control); descriptions and source paths are dropped — they turned every
  // folder index into a wall of truncated prose.
  const filesHtml = fileEntries.length > 0
    ? `<ul class="he-linklist" id="docs-list">
    ${fileEntries
      .map(
        (f) => `
    <li class="he-linklist__row" data-date="${f.date || ''}" data-title="${escapeHtml(f.title)}">
      <a class="he-linklist__link" href="${escapeHref(f.href)}">${escapeHtml(f.title)}</a>
      ${f.date ? `<span class="he-linklist__meta">${escapeHtml(f.date)}</span>` : ''}
    </li>`
      )
      .join('')}
  </ul>`
    : `<p class="he-empty">No documents in this folder.</p>`

  const body = `
<nav class="he-bc" aria-label="Breadcrumb">
  ${breadcrumbHtml}
</nav>
${subdirsHtml}
${fileEntries.length > 0
      ? `<div class="he-folder-controls">
  <label for="sort-select">Sort</label>
  <select id="sort-select" onchange="sortDocs(this.value)" class="he-sort-select">
    <option value="newest">Newest first</option>
    <option value="oldest">Oldest first</option>
    <option value="az">A → Z</option>
    <option value="za">Z → A</option>
  </select>
</div>`
      : ''}
${filesHtml}
<script>
function sortDocs(criteria) {
  const list = document.getElementById('docs-list');
  if (!list) return;
  const rows = Array.from(list.children);
  rows.sort((a, b) => {
    const aDate = a.dataset.date || '';
    const bDate = b.dataset.date || '';
    const aTitle = a.dataset.title || '';
    const bTitle = b.dataset.title || '';
    switch (criteria) {
      case 'newest': return bDate.localeCompare(aDate) || aTitle.localeCompare(bTitle);
      case 'oldest': return aDate.localeCompare(bDate) || aTitle.localeCompare(bTitle);
      case 'az': return aTitle.localeCompare(bTitle);
      case 'za': return bTitle.localeCompare(aTitle);
      default: return 0;
    }
  });
  rows.forEach(row => list.appendChild(row));
}
</script>
`

  const html = pageHtml({
    title: folderTitle,
    eyebrow: breadcrumbItems[0]?.label || 'Docs',
    deckHtml: '',
    body,
    toc: [],
    project,
    navLinks,
    basePathToHtml,
    currentPath: path.join(outDir, 'index.html'),
    isIndex: true,
  })

  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'index.html'), html, 'utf8')
}

// ── Build the index ──────────────────────────────────────────────────────
async function buildIndex({ project, sectionResults, navLinks, rootDocs, rootDocTitles }) {
  // Root-level markdown (docs/*.md) first — these used to be skipped entirely.
  const rootDocsHtml =
    rootDocs.length > 0
      ? `
<section class="he-index-section" id="top-level">
  <h2 class="he-index-section__title">Top-level</h2>
  <ul class="he-linklist">
${rootDocs
        .map((f) => {
          const slug = f.replace(/\.md$/i, '.html')
          return `<li class="he-linklist__row">
      <a class="he-linklist__link" href="./${escapeHref(slug)}">${escapeHtml(rootDocTitles.get(f) || humanize(f.replace(/\.md$/i, '')))}</a>
    </li>`
        })
        .join('\n    ')}
  </ul>
</section>`
      : ''

  // One row per section: the section title links to its folder index, and each
  // document underneath is a plain title link. No blurbs, no descriptions, no
  // source paths.
  const sectionsHtml = sectionResults
    .map((s) => {
      const links = s.files
        .map(
          (f) => `<li class="he-linklist__row">
      <a class="he-linklist__link" href="./${escapeHref(f.slug)}.html">${escapeHtml(f.title)}</a>
    </li>`
        )
        .join('\n    ')

      return `
<section class="he-index-section" id="${escapeHref(s.dir)}">
  <h2 class="he-index-section__title"><a href="./${escapeHref(s.dir)}/index.html">${escapeHtml(s.title)}</a> <span class="he-linklist__meta">${s.files.length}</span></h2>
  <ul class="he-linklist">
    ${links}
  </ul>
</section>`
    })
    .join('\n')

  // Hand-authored HTML that isn't markdown-derived. Lives at the root of
  // docs/html/ (e.g. visual reports) or in sibling folders such as ui/.
  //
  // "Not generated" is decided by the build manifest, not by set membership:
  // membership alone would relabel the orphaned page of a deleted or renamed
  // markdown file as hand-authored.
  const generatedDirs = new Set(sectionResults.map((s) => s.dir))
  const generated = readGeneratedManifest()
  const standaloneFiles = []
  for (const ent of await fs.readdir(OUT, { withFileTypes: true }).catch(() => [])) {
    if (ent.isFile() && ent.name.endsWith('.html')) {
      if (ent.name !== 'index.html' && !isGenerated(generated, ent.name)) standaloneFiles.push(ent.name)
      continue
    }
    if (!ent.isDirectory()) continue
    if (generatedDirs.has(ent.name)) continue
    const entries = await fs.readdir(path.join(OUT, ent.name), { withFileTypes: true }).catch(() => [])
    for (const child of entries) {
      // Generated folder indexes only exist inside generatedDirs, which is
      // skipped wholesale above — so an index.html here is hand-authored.
      if (child.isFile() && child.name.endsWith('.html') && !isGenerated(generated, `${ent.name}/${child.name}`)) {
        standaloneFiles.push(`${ent.name}/${child.name}`)
      }
    }
  }
  standaloneFiles.sort()

  const standalone =
    standaloneFiles.length > 0
      ? `
<section class="he-index-section" id="standalone">
  <h2 class="he-index-section__title">Standalone HTML</h2>
  <ul class="he-linklist">
    ${standaloneFiles
      .map((f) => {
        // The label is display text, so decode any entity baked into the
        // filename; escapeHtml re-escapes it correctly on output.
        const base = f
          .split('/')
          .pop()
          .replace(/\.html$/i, '')
          .replace(/&amp;/gi, '&')
        return `<li class="he-linklist__row">
      <a class="he-linklist__link" href="${escapeHref(f)}">${escapeHtml(humanize(base))}</a>
    </li>`
      })
      .join('\n    ')}
  </ul>
</section>`
      : ''

  const totalDocs =
    sectionResults.reduce((s, sec) => s + sec.files.length, 0) + rootDocs.length + standaloneFiles.length
  const totalSections = sectionResults.length + (rootDocs.length > 0 ? 1 : 0) + (standaloneFiles.length > 0 ? 1 : 0)
  const body = `
<p class="he-index-summary">${totalDocs} document${totalDocs === 1 ? '' : 's'} in ${totalSections} section${totalSections === 1 ? '' : 's'}.</p>
${rootDocsHtml}
${sectionsHtml}
${standalone}
`

  const html = pageHtml({
    title: 'Documentation',
    eyebrow: `${project} · docs`,
    deckHtml: '',
    body,
    toc: [],
    project,
    navLinks,
    basePathToHtml: './',
    isIndex: true,
    currentPath: path.join(OUT, 'index.html'),
  })
  await fs.writeFile(path.join(OUT, 'index.html'), html, 'utf8')
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const project = await readProjectName()
  await fs.mkdir(OUT, { recursive: true })

  // Write tokens + site CSS into /html/ so all generated pages can link them.
  const tokens = await resolveTokens()
  await fs.writeFile(path.join(OUT, 'design-tokens.css'), tokens.css, 'utf8')
  await fs.writeFile(path.join(OUT, 'docs.css'), SITE_CSS, 'utf8')

  // Discover all sections (directories with .md files)
  const sections = await discoverSections()
  const navLinks = sections

  const sectionResults = []
  for (const section of sections) {
    const srcDir = path.join(DOCS, section.dir)
    const outDir = path.join(OUT, section.dir)
    const files = await walkMd(srcDir)
    const built = []
    for (const src of files) {
      const rel = path.relative(srcDir, src)
      const slug = rel.replace(/\.md$/, '')
      const outPath = path.join(outDir, slug + '.html')
      const result = await buildPage({
        src,
        outPath,
        section,
        project,
        navLinks,
      })
      built.push(result)
    }
    sectionResults.push({ ...section, files: built })
  }

  // Generate folder index pages for every directory containing markdown files.
  // Recurses from each top-level docs subdirectory.
  const folderPages = []
  async function generateFolderIndexes(srcDir, outDir) {
    const hasMd = await dirHasMd(srcDir)
    if (!hasMd) return

    await buildFolderPage({ srcDir, outDir, project, navLinks })
    folderPages.push({ srcDir, outDir })

    // Recurse into subdirectories
    const { subdirs } = await getDirectChildren(srcDir)
    for (const sd of subdirs) {
      const childSrc = path.join(srcDir, sd)
      if (isOutputDir(childSrc)) continue
      const childOut = path.join(outDir, sd)
      await generateFolderIndexes(childSrc, childOut)
    }
  }

  // Start recursion from each top-level docs subdirectory
  const topLevelEntries = await fs.readdir(DOCS, { withFileTypes: true }).catch(() => [])
  for (const ent of topLevelEntries) {
    if (ent.isDirectory() && !isOutputDir(path.join(DOCS, ent.name))) {
      await generateFolderIndexes(path.join(DOCS, ent.name), path.join(OUT, ent.name))
    }
  }

  // Root-level docs/*.md → docs/html/<slug>.html. These sit outside every
  // section directory, so the section walk above never reaches them.
  const rootDocs = await findRootDocs()
  const rootDocTitles = new Map()
  for (const f of rootDocs) {
    const src = path.join(DOCS, f)
    const md = await fs.readFile(src, 'utf8')
    const { title } = parseHeader(md, f.replace(/\.md$/i, ''))
    rootDocTitles.set(f, title)
    await buildPage({
      src,
      outPath: path.join(OUT, f.replace(/\.md$/i, '.html')),
      section: { title: 'Docs' },
      project,
      navLinks,
    })
  }

  // Everything written by this run, so a later run can prune what vanished.
  const generated = new Set()
  const track = (outPath) => {
    generated.add(path.relative(OUT, outPath).replaceAll('\\', '/'))
  }
  for (const sec of sectionResults) for (const f of sec.files) track(path.join(OUT, `${f.slug}.html`))
  for (const f of rootDocs) track(path.join(OUT, f.replace(/\.md$/i, '.html')))
  for (const fp of folderPages) track(path.join(fp.outDir, 'index.html'))
  track(path.join(OUT, 'index.html'))

  await buildIndex({ project, sectionResults, navLinks, rootDocs, rootDocTitles })
  const pruned = await pruneStalePages(generated)
  await writeGeneratedManifest(generated)

  const total = generated.size - folderPages.length - 1
  console.log(
    `[build-docs-html] generated ${total} HTML pages (${rootDocs.length} root-level) + ${folderPages.length} folder indexes + index across ${sections.length} sections`
  )
  if (pruned.length > 0) {
    console.log(`[build-docs-html] pruned ${pruned.length} stale page(s): ${pruned.join(', ')}`)
  }
}

async function readProjectName() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'))
    if (pkg.name) {
      // "novastar-montessori" → "Novastar Montessori"
      return pkg.name
        .split(/[-_\s]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    }
  } catch (e) {}
  return 'Project'
}

main().catch((err) => {
  console.error('[build-docs-html] failed:', err)
  process.exit(1)
})
