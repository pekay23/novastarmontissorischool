/**
 * Docs HTML coverage — the structural guarantee that no markdown source under
 * `docs/` is silently skipped by the HTML build.
 *
 * The defect this exists to remove: a directory walk that swallows a readdir
 * error, or an output path derived with a filter that quietly drops a file,
 * produces a build that prints success while whole documents are absent. The
 * only reliable answer to "did every document get a page?" is to re-walk the
 * filesystem after the build and compare the two sets, so that is what this
 * module does.
 *
 * Two entry points, deliberately the same code path:
 *   - `build-docs-html.mjs` calls `auditCoverage()` at the end of the build.
 *   - `bun scripts/docs-html-coverage.mjs` runs it standalone against whatever
 *     is on disk, with no knowledge of the build's own bookkeeping.
 *
 * Run standalone:  bun scripts/docs-html-coverage.mjs
 * Exits 1 and names every defect when the invariant does not hold.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One predicate for "is this a markdown source", case-insensitively, so
// `docs/NOTES.MD` is a legitimate authoring choice on Windows/macOS.
export const isMarkdownName = (name) => name.toLowerCase().endsWith('.md')

// Never sources, whatever their contents.
const EXCLUDED_DIRS = new Set(['node_modules'])

// A readdir failure must never be read as "this folder is empty". ENOENT and
// ENOTDIR are the two answers that legitimately mean "nothing here"; anything
// else (EACCES, EPERM, EMFILE, a transient share hiccup) is a real fault and
// has to reach the caller, because the alternative is a green build with a
// whole subtree of documents missing.
export async function readDirStrict(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    const code = err && err.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw new Error(`cannot read directory ${dir}: ${err && err.message}`)
  }
}

// `docs/html` is the build's own output. Treating it as a source would make the
// build recurse into its own generated pages.
export function isOutputDir(outputDir, candidate) {
  return path.resolve(candidate) === path.resolve(outputDir)
}

/**
 * Every markdown source under `docsDir`, recursively, sorted, output dir and
 * node_modules excluded. Throws rather than returning a short list.
 *
 * @returns {Promise<string[]>} absolute paths
 */
export async function listMarkdownSources(docsDir, outputDir) {
  const out = []

  async function walk(dir) {
    const entries = await readDirStrict(dir)
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (EXCLUDED_DIRS.has(ent.name.toLowerCase())) continue
        if (isOutputDir(outputDir, full)) continue
        await walk(full)
      } else if (ent.isFile() && isMarkdownName(ent.name)) {
        out.push(full)
      }
    }
  }

  await walk(docsDir)
  return out.sort()
}

/**
 * The mirrored output path for one source: `docs/a/b.md` -> `<out>/a/b.html`.
 * The extension strip is case-insensitive so `NOTES.MD` does not land as
 * `NOTES.MD.html`.
 */
export function mirrorOutputPath(docsDir, outputDir, src) {
  const rel = path.relative(docsDir, src)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`source is outside the docs tree: ${src}`)
  }
  return path.join(outputDir, rel.replace(/\.md$/i, '.html'))
}

/** Key used to detect two sources that would claim the same output file. */
export function outputKey(outputDir, outPath) {
  // Lowercased because a case-insensitive filesystem resolves these to one
  // file; without the fold the second source silently overwrites the first.
  return path.relative(outputDir, outPath).replaceAll('\\', '/').toLowerCase()
}

/**
 * Detect two sources competing for one output path.
 *
 * @returns {Array<{ output: string, sources: string[] }>}
 */
export function findCollisions(docsDir, outputDir, sources) {
  const byKey = new Map()
  for (const src of sources) {
    const outPath = mirrorOutputPath(docsDir, outputDir, src)
    const key = outputKey(outputDir, outPath)
    const bucket = byKey.get(key)
    if (bucket) bucket.sources.push(src)
    else byKey.set(key, { output: outPath, sources: [src] })
  }
  return [...byKey.values()].filter((b) => b.sources.length > 1)
}

/**
 * The invariant: one non-empty HTML file per markdown source, at the mirrored
 * path. Checked against the filesystem, not against the build's bookkeeping.
 *
 * @returns {Promise<{
 *   sourceCount: number,
 *   missing: Array<{ source: string, expected: string }>,
 *   empty: Array<{ source: string, output: string }>,
 *   collisions: Array<{ output: string, sources: string[] }>,
 *   ok: boolean,
 * }>}
 */
export async function auditCoverage({ docsDir, outputDir, sources } = {}) {
  const list = sources ?? (await listMarkdownSources(docsDir, outputDir))
  const missing = []
  const empty = []

  for (const src of list) {
    const expected = mirrorOutputPath(docsDir, outputDir, src)
    let stat
    try {
      stat = await fs.stat(expected)
    } catch {
      missing.push({ source: src, expected })
      continue
    }
    if (!stat.isFile()) {
      missing.push({ source: src, expected })
      continue
    }
    if (stat.size === 0) empty.push({ source: src, output: expected })
  }

  const collisions = findCollisions(docsDir, outputDir, list)
  return {
    sourceCount: list.length,
    missing,
    empty,
    collisions,
    ok: missing.length === 0 && empty.length === 0 && collisions.length === 0,
  }
}

const posix = (p) => p.replaceAll('\\', '/')

/** Human-readable, sorted defect report. Returns '' when the invariant holds. */
export function formatCoverageReport(result, { docsDir, outputDir } = {}) {
  const { missing, empty, collisions } = result
  if (result.ok) return ''

  const rel = (p) => (docsDir ? posix(path.relative(docsDir, p)) : posix(p))
  const relOut = (p) => (outputDir ? posix(path.relative(outputDir, p)) : posix(p))
  const lines = []

  if (missing.length > 0) {
    lines.push(`  ${missing.length} source document(s) with no generated page:`)
    for (const m of missing.sort((a, b) => a.source.localeCompare(b.source))) {
      lines.push(`    ${rel(m.source)}  ->  expected ${relOut(m.expected)}`)
    }
  }
  if (empty.length > 0) {
    lines.push(`  ${empty.length} generated page(s) that are empty:`)
    for (const e of empty.sort((a, b) => a.source.localeCompare(b.source))) {
      lines.push(`    ${rel(e.source)}  ->  ${relOut(e.output)}`)
    }
  }
  if (collisions.length > 0) {
    lines.push(`  ${collisions.length} output path(s) claimed by more than one source:`)
    for (const c of collisions) {
      lines.push(`    ${relOut(c.output)}  <-  ${c.sources.map(rel).join(' , ')}`)
    }
  }
  return lines.join('\n')
}

/** Thrown by the build when coverage fails, so the process exits non-zero. */
export class DocsCoverageError extends Error {
  constructor(result, { docsDir, outputDir } = {}) {
    super(
      `docs HTML coverage failed: ${result.sourceCount} markdown source(s) under ` +
        `${docsDir} did not each get one HTML page at a mirrored path.\n` +
        formatCoverageReport(result, { docsDir, outputDir })
    )
    this.name = 'DocsCoverageError'
    this.result = result
  }
}

// ── Standalone mode ────────────────────────────────────────────────────────
const invokedDirectly =
  import.meta.main ??
  (process.argv[1]
    ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
    : false)

if (invokedDirectly) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const root = path.resolve(here, '..')
  const docsDir = path.join(root, 'docs')
  const outputDir = path.join(docsDir, 'html')

  const sources = await listMarkdownSources(docsDir, outputDir)
  const result = await auditCoverage({ docsDir, outputDir, sources })

  console.log(`[docs-html-coverage] ${sources.length} markdown source(s) under ${posix(path.relative(root, docsDir))}/`)
  if (result.ok) {
    console.log('[docs-html-coverage] OK: every source has a non-empty mirrored HTML page')
  } else {
    console.error('[docs-html-coverage] FAILED')
    console.error(formatCoverageReport(result, { docsDir, outputDir }))
    process.exit(1)
  }
}