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

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const DOCS = path.join(ROOT, 'docs')
const OUT = path.join(DOCS, 'html')
const TOKENS_SRC = path.join(ROOT, '.claude/skills/html-effectiveness/references/design-tokens.css')

// Section metadata — titles and blurbs for the index page.
// Directories listed here appear first (in this order) on the index.
// Sections not listed here are auto-discovered with generic metadata.
const SECTION_META = {
  'architecture':  { title: 'Architecture',  blurb: 'Architecture diagrams, data models, and system design documentation.' },
  'audit-reports': { title: 'Audit Reports',  blurb: 'Comprehensive audits of the platform, phase by phase.' },
  'business':      { title: 'Business',       blurb: 'Non-technical, stakeholder-facing documents and business plans.' },
  'technical':     { title: 'Technical',      blurb: 'Technical implementation plans, schemas, and code structure.' },
  'adr':           { title: 'ADRs',           blurb: 'Architecture Decision Records — captured design choices.' },
  'api':           { title: 'API',            blurb: 'OpenAPI/Swagger specifications and API documentation.' },
  'wireframes':    { title: 'Wireframes',     blurb: 'Excalidraw wireframe files for UI/UX review.' },
  'guides':        { title: 'Guides',         blurb: 'Operational how-tos — setup, deployment, handover.' },
  'compliance':    { title: 'Compliance',     blurb: 'Regulatory registers — data protection, DPIA.' },
  'plans':         { title: 'Plans',          blurb: 'RFCs and implementation roadmaps.' },
  'design':        { title: 'Design',         blurb: 'Design system — tokens, typography, components.' },
  'operations':    { title: 'Operations',     blurb: 'Branch strategy, CI/CD, deployment workflows.' },
}

// ── HTML helpers ─────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
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
    if (known.includes(ent.name)) continue
    const fullPath = path.join(DOCS, ent.name)
    if (await dirHasMd(fullPath)) {
      result.push({ dir: ent.name, title: ent.name, blurb: 'Documentation section.' })
    }
  }

  return result
}

// ── Marked renderer overrides ────────────────────────────────────────────
// We extend marked to:
//   - rewrite *.md → *.html in internal links
//   - emit numbered editorial section headers (01 · Title) for top-level h2s
//   - give every h2/h3 an id for the TOC sidebar

function buildMarkdownCallbacks() {
  let h2Counter = 0

  const escape = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  function processBodyHtml(html) {
    // 1. Rewrite internal .md links to .html (skip absolute URLs)
    let out = html.replace(/href="([^"]+\.md)(#([^"]*))?"/g, (match, href, hash) => {
      if (/^https?:/i.test(href)) return match
      const newHref = href.replace(/\.md(?=#|$)/i, '.html')
      return `href="${newHref}${hash || ''}"`
    })

    // 2. Convert blockquotes starting with <p><strong> to editorial pull-quotes
    out = out.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (match, content) => {
      const trimmed = content.trim()
      if (/^<p><strong>/.test(trimmed)) {
        return `<blockquote class="he-pull">${content}</blockquote>`
      }
      return match
    })

    // 3. Wrap h2 headings in numbered editorial sections; add ids to h3+
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
    render: (md) => processBodyHtml(Bun.markdown.html(md)),
    renderInline: (md) => Bun.markdown.html(md),
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
  const title = h1Match ? h1Match[1].trim() : slug
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
    if (ent.isFile() && ent.name.endsWith('.md')) {
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
    if (ent.isFile() && ent.name.endsWith('.md')) return true
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
      out.push(...(await walkMd(path.join(dir, ent.name))))
    } else if (ent.name.endsWith('.md')) {
      out.push(path.join(dir, ent.name))
    }
  }
  return out.sort()
}

// ── Page template ────────────────────────────────────────────────────────
function pageHtml({ title, eyebrow, deckHtml, body, toc, project, navLinks, basePathToHtml, isIndex, currentPath }) {
  const nav = `
<nav class="he-nav">
  <a class="he-nav__brand" href="${basePathToHtml}index.html">${escapeHtml(project)} <small>docs</small></a>
  <div class="he-nav__links">
    <a href="${basePathToHtml}index.html">Index</a>
    ${navLinks.map((n) => `<a href="${basePathToHtml}${n.dir}/index.html">${escapeHtml(n.title)}</a>`).join('\n    ')}
  </div>
</nav>`

  const tocHtml =
    toc && toc.length >= 3
      ? `
<aside class="he-toc" aria-label="On this page">
  <p class="he-toc__label">On this page</p>
  <ul>
    ${toc.map((t) => `<li class="he-toc__l${t.depth}"><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`).join('\n    ')}
  </ul>
</aside>`
      : ''

  const useTwoCol = !!tocHtml && !isIndex
  const layoutOpen = useTwoCol ? '<div class="he-layout">' : ''
  const layoutClose = useTwoCol ? '</div>' : ''
  const mainOpen = useTwoCol ? '<main class="he-main">' : '<main>'
  const mainClose = '</main>'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)} · ${escapeHtml(project)}</title>
<link rel="stylesheet" href="${relativeHref(currentPath, path.join(OUT, 'design-tokens.css'))}">
<link rel="stylesheet" href="${relativeHref(currentPath, path.join(OUT, 'docs.css'))}">
</head>
<body>
<div class="he-shell ${useTwoCol ? 'he-shell--wide' : ''}">
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
  Source · <a href="${relativeHref(currentPath, DOCS)}">browse the markdown</a> · rebuild with <code>bun run docs:html</code>
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

/* Index page: section heading + cards */
.he-index-section { margin-top: var(--sp-7); }
.he-index-section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-bottom: var(--sp-4);
  padding-bottom: var(--sp-3);
  border-bottom: 1px solid var(--border);
}
.he-index-section__head h2 { margin: 0; font-size: var(--t-h2-size); font-weight: 500; }
.he-index-section__blurb { color: var(--fg-muted); font-size: var(--t-small-size); margin: 0; max-width: 50ch; text-align: right; }

/* "Standalone HTML" section uses minimal cards */
.he-standalone-grid { display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.he-standalone-card {
  padding: var(--sp-4) var(--sp-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
}
.he-standalone-card a { font-weight: 500; }
.he-standalone-card p { font-size: var(--t-small-size); color: var(--fg-muted); margin: var(--sp-1) 0 0; }

/* Index page: section link + folder meta */
.he-index-section__link { color: inherit; text-decoration: none; }
.he-index-section__link:hover h2 { color: var(--clay); }
.he-folder-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--sp-2);
  font-size: var(--t-small-size);
  color: var(--fg-muted);
}
.he-folder-meta__link {
  font-weight: 500;
  color: var(--clay);
  text-decoration: none;
}
.he-folder-meta__link:hover { text-decoration: underline; }

/* Folder pages */
.he-bc { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; margin: var(--sp-4) 0; font-size: var(--t-small-size); }
.he-bc__item { color: var(--fg-muted); text-decoration: none; }
.he-bc__item:hover { color: var(--clay); text-decoration: underline; }
.he-bc__sep { color: var(--border); }

.he-folder-grid { display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: var(--sp-6); }
.he-folder-card {
  display: flex; flex-direction: column; align-items: center; gap: var(--sp-2);
  padding: var(--sp-4); background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--r-md); text-decoration: none; color: inherit;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.he-folder-card:hover { border-color: var(--clay); box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
.he-folder-card__icon { font-size: 1.5rem; }
.he-folder-card__name { font-weight: 500; }
.he-folder-card__count { font-size: var(--t-small-size); color: var(--fg-muted); }

.he-folder-controls {
  display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4);
}
.he-folder-controls label { font-size: var(--t-small-size); color: var(--fg-muted); font-weight: 500; }
.he-sort-select {
  padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md); border: 1px solid var(--border);
  background: var(--surface); color: inherit; font-size: var(--t-small-size);
}

.he-docs-table { width: 100%; border-collapse: collapse; font-size: var(--t-small-size); }
.he-docs-table th {
  text-align: left; padding: var(--sp-3) var(--sp-4); border-bottom: 2px solid var(--border);
  font-weight: 600; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.05em; font-size: var(--t-caption-size);
}
.he-docs-table td { padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); vertical-align: top; }
.he-docs-table tr:hover td { background: rgba(0,0,0,0.02); }
.he-docs-table td:first-child { font-weight: 500; }
.he-docs-table td a { color: var(--clay); text-decoration: none; }
.he-docs-table td a:hover { text-decoration: underline; }
.he-docs-table code {
  font-size: 0.85em; background: rgba(0,0,0,0.04); padding: 0.1em 0.35em; border-radius: 0.25em;
  color: var(--fg-muted);
}
.he-docs-table .he-empty { text-align: center; color: var(--fg-muted); padding: var(--sp-8) var(--sp-4); }
`

// ── Build one MD file ────────────────────────────────────────────────────
async function buildPage({ src, outPath, section, project, navLinks }) {
  const md = await fs.readFile(src, 'utf8')
  const { title, deckMarkdown } = parseHeader(md, path.basename(src, '.md'))
  const toc = extractToc(md)
  const stripped = stripHeader(md)

  const { render, renderInline, resetCounter } = buildMarkdownCallbacks()
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
    slug: path.relative(path.dirname(outPath), outPath).replace(/\.html$/, ''),
    title,
    deck: deckMarkdown, // raw text for card grid preview
    srcRelative: path.relative(ROOT, src).replaceAll('\\', '/'),
  }
}

// ── Build a folder index page ──────────────────────────────────────────────
async function buildFolderPage({ srcDir, outDir, project, navLinks, sectionTitle }) {
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
    const { title, deckMarkdown } = parseHeader(md, f.replace(/\.md$/, ''), null)
    const stat = await fs.stat(src).catch(() => null)
    const mtime = stat ? stat.mtime.toISOString().slice(0, 10) : ''
    const date = extractDate(f) || mtime
    fileEntries.push({
      title,
      deck: deckMarkdown,
      date,
      srcRelative: path.relative(ROOT, src).replaceAll('\\', '/'),
      href: path.relative(outDir, path.join(outDir, path.relative(srcDir, src).replace(/\.md$/, '.html'))).replaceAll('\\', '/'),
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
  const folderPagePath = path.join(outDir, 'index.html')
  const folderDepth = path.relative(OUT, outDir).split(path.sep).filter(Boolean).length
  const basePathToHtml = folderDepth <= 0 ? './' : '../'.repeat(folderDepth)
  const breadcrumbItems = [{ label: 'Docs', href: relativeHref(folderPagePath, path.join(OUT, 'index.html')) }]
  for (let i = 0; i < parts.length; i++) {
    const ancestorPath = path.join(OUT, ...parts.slice(0, i + 1), 'index.html')
    breadcrumbItems.push({ label: parts[i], href: relativeHref(folderPagePath, ancestorPath) })
  }
  const breadcrumbHtml = breadcrumbItems
    .map((bc, i) => {
      const isLast = i === breadcrumbItems.length - 1
      if (isLast) return `<span class="he-bc__item">${escapeHtml(bc.label)}</span>`
      return `<a class="he-bc__item" href="${bc.href}">${escapeHtml(bc.label)}</a>`
    })
    .join('<span class="he-bc__sep">/</span>')

  const subdirsHtml = subdirEntries.length > 0
    ? `
  <div class="he-folder-grid">
    ${subdirEntries.map((sd) => `
    <a class="he-folder-card" href="${sd.name}/index.html">
      <div class="he-folder-card__icon">📁</div>
      <div class="he-folder-card__name">${escapeHtml(sd.name)}</div>
      <div class="he-folder-card__count">${sd.count} document${sd.count === 1 ? '' : 's'}</div>
    </a>`).join('')}
  </div>`
    : ''

  const filesTableRows = fileEntries.length > 0
    ? fileEntries
        .map(
          (f) => `
    <tr data-date="${f.date || ''}" data-title="${escapeHtml(f.title)}">
      <td><a href="${f.href}">${escapeHtml(f.title)}</a></td>
      <td>${escapeHtml(f.date || '—')}</td>
      <td>${escapeHtml((f.deck || '').slice(0, 120))}</td>
      <td><code>${escapeHtml(f.srcRelative)}</code></td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="he-empty">No documents in this folder.</td></tr>`

  const body = `
<nav class="he-bc" aria-label="Breadcrumb">
  ${breadcrumbHtml}
</nav>
${subdirsHtml}
<div class="he-folder-controls">
  <label for="sort-select">Sort by</label>
  <select id="sort-select" onchange="sortDocs(this.value)" class="he-sort-select">
    <option value="newest">Newest first</option>
    <option value="oldest">Oldest first</option>
    <option value="az">A → Z</option>
    <option value="za">Z → A</option>
  </select>
</div>
<table class="he-docs-table">
  <thead>
    <tr>
      <th>Title</th>
      <th>Date</th>
      <th>Description</th>
      <th>Source</th>
    </tr>
  </thead>
  <tbody id="docs-table-body">
    ${filesTableRows}
  </tbody>
</table>
<script>
function sortDocs(criteria) {
  const tbody = document.getElementById('docs-table-body');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
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
  tbody.innerHTML = '';
  rows.forEach(row => tbody.appendChild(row));
}
</script>
`

  const html = pageHtml({
    title: sectionTitle,
    eyebrow: breadcrumbItems[0]?.label || 'Docs',
    deckHtml: `${fileEntries.length} document${fileEntries.length === 1 ? '' : 's'} in this folder`,
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

  return {
    title: sectionTitle,
    fileCount: fileEntries.length,
    subdirCount: subdirEntries.length,
    srcRelative: path.relative(ROOT, srcDir).replaceAll('\\', '/'),
  }
}

// ── Build the index ──────────────────────────────────────────────────────
async function buildIndex({ project, sectionResults, navLinks }) {
  const sectionsHtml = sectionResults
    .map((s) => {
      const cards = s.files
        .map(
          (f) => `
    <a class="he-card" href="./${s.dir}/${f.slug}.html">
      <div class="he-card__eyebrow">${escapeHtml(s.title)}</div>
      <h3>${escapeHtml(f.title)}</h3>
      <p>${escapeHtml((f.deck || '').slice(0, 180))}</p>
      <div class="he-card__meta">
        <span>${escapeHtml(f.srcRelative)}</span>
      </div>
    </a>`
        )
        .join('')

      return `
<section class="he-index-section" id="${s.dir}">
  <a class="he-index-section__head he-index-section__link" href="./${s.dir}/index.html">
    <h2>${escapeHtml(s.title)}</h2>
    <p class="he-index-section__blurb">${escapeHtml(s.blurb)} · Browse folder →</p>
  </a>
  <div class="he-grid">${cards}
  </div>
</section>`
    })
    .join('\n')

  // Hand-authored HTMLs at the root of /html/
  const handAuthored = (await fs.readdir(OUT))
    .filter((f) => f.endsWith('.html') && f !== 'index.html')
    .filter(async (f) => {
      const stat = await fs.stat(path.join(OUT, f)).catch(() => null)
      return stat && !stat.isDirectory()
    })

  const standalone =
    handAuthored.length > 0
      ? `
<section class="he-index-section" id="standalone">
  <div class="he-index-section__head">
    <h2>Standalone HTML</h2>
    <p class="he-index-section__blurb">Hand-authored visual reports — not derived from markdown.</p>
  </div>
  <div class="he-standalone-grid">
    ${handAuthored
      .map(
        (f) => `<div class="he-standalone-card">
      <a href="./${f}">${escapeHtml(f.replace(/-/g, ' ').replace('.html', ''))}</a>
      <p>↗ open report</p>
    </div>`
      )
      .join('\n    ')}
  </div>
</section>`
      : ''

  const total = sectionResults.reduce((s, sec) => s + sec.files.length, 0)
  const body = `
<div class="he-kpis">
  <div class="he-kpi"><div class="he-kpi__value">${total}</div><div class="he-kpi__label">Generated pages</div></div>
  <div class="he-kpi"><div class="he-kpi__value">${sectionResults.length}</div><div class="he-kpi__label">Sections</div></div>
  <div class="he-kpi"><div class="he-kpi__value">${handAuthored.length}</div><div class="he-kpi__label">Standalone reports</div></div>
</div>
${sectionsHtml}
${standalone}
`

  const html = pageHtml({
    title: 'Documentation',
    eyebrow: `${project} · docs`,
    deckHtml:
      'All project documentation, organised by purpose. Markdown sources live in <code>docs/architecture</code>, <code>docs/audit-reports</code>, <code>docs/business</code>, <code>docs/technical</code>, <code>docs/adr</code>, and more. Hover over a card to open a document.',
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

  // Copy tokens + site CSS into /html/ so all generated pages can link them.
  await fs.copyFile(TOKENS_SRC, path.join(OUT, 'design-tokens.css'))
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

    const folderTitle = path.basename(srcDir)
    const page = await buildFolderPage({
      srcDir,
      outDir,
      project,
      navLinks,
      sectionTitle: folderTitle,
    })
    folderPages.push(page)

    // Recurse into subdirectories
    const { subdirs } = await getDirectChildren(srcDir)
    for (const sd of subdirs) {
      const childSrc = path.join(srcDir, sd)
      const childOut = path.join(outDir, sd)
      await generateFolderIndexes(childSrc, childOut)
    }
  }

  // Start recursion from each top-level docs subdirectory
  const topLevelEntries = await fs.readdir(DOCS, { withFileTypes: true }).catch(() => [])
  for (const ent of topLevelEntries) {
    if (ent.isDirectory()) {
      const srcDir = path.join(DOCS, ent.name)
      const outDir = path.join(OUT, ent.name)
      await generateFolderIndexes(srcDir, outDir)
    }
  }

  await buildIndex({ project, sectionResults, navLinks })

  const total = sectionResults.reduce((s, sec) => s + sec.files.length, 0)
  const folderTotal = folderPages.length
  console.log(
    `[build-docs-html] generated ${total} HTML pages + ${folderTotal} folder indexes + index across ${sections.length} sections (design-tokens + docs.css copied into docs/html/)`
  )
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
