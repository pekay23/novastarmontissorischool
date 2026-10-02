// Text-encoding guard: finds cp1252/latin-1 mojibake and invalid encodings
// before they reach a commit or a rendered docs site.
//
// Usage:
//   node tools/check-text-encoding.mjs            # git-tracked files
//   node tools/check-text-encoding.mjs --all      # whole working tree
//   node tools/check-text-encoding.mjs --fix      # repair mojibake in place
//
// Exit code is 1 when anything is found, so it can gate CI.
//
// Why this exists: UTF-8 text that is read as cp1252 and written back becomes
// "a-U+00E2-U+20AC-U+201D" instead of an em dash. The corruption is invisible in
// a cp1252 terminal, so it survives review and reaches the docs site.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(process.cwd())
const args = process.argv.slice(2)
const SCAN_ALL = args.includes('--all')
const FIX = args.includes('--fix')

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'out', '.turbo', '.vercel',
  'build', 'coverage', '.output', '.kilo',
])

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff',
  '.woff2', '.ttf', '.otf', '.eot', '.zip', '.gz', '.mp4', '.mp3', '.lock',
])

// Node has no cp1252 codec, so build the reverse table (char -> byte) by hand.
// Bytes 0x80-0x9F are the ones that differ from latin-1; everything at or below
// U+00FF maps to itself. The five slots undefined in cp1252 (0x81, 0x8D, 0x8F,
// 0x90, 0x9D) appear as C1 controls when a latin-1 fallback does the decoding,
// so they are listed as their own codepoints.
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x008b, 0x0178, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x009b, 0x0153, 0x009d, 0x017e, 0x009f,
]

const CP1252_REV = new Map()
CP1252_HIGH.forEach((cp, i) => {
  if (cp > 0x9f) CP1252_REV.set(String.fromCodePoint(cp), 0x80 + i)
})

// Characters that encode to a single byte >= 0x80 under cp1252/latin-1 can be
// part of mojibake. Note the continuation characters are not C1 controls:
// byte 0x80 is "EUR" (U+20AC) and 0x9D is a curly quote (U+201D) in cp1252,
// so the 3-character run for a corrupted em dash is U+00E2 U+20AC U+201D.
function asByte(ch) {
  const cp = ch.codePointAt(0)
  if (cp <= 0xff) return cp
  return CP1252_REV.has(ch) ? CP1252_REV.get(ch) : null
}

function isLead(ch) {
  const b = asByte(ch)
  return b !== null && b >= 0x80
}

// Grow a run of mojibake characters, re-encoding to the bytes the bad decode
// consumed, and flag the longest prefix that is valid UTF-8.
function findSpans(text) {
  const spans = []
  let i = 0
  while (i < text.length) {
    if (!isLead(text[i])) {
      i += 1
      continue
    }
    const start = i
    const bytes = []
    const chars = []
    let best = null
    let j = i
    while (j < text.length) {
      const ch = text[j]
      if (ch === '\ufffd' || (!isLead(ch) && ch !== ' ')) break
      if (ch === ' ' && !isLead(text[j + 1] ?? '')) break
      const b = asByte(ch)
      if (b === null) break
      bytes.push(b)
      chars.push(ch)
      let decoded = null
      try {
        decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes))
      } catch {
        // A short run may just be an incomplete multi-byte sequence, which is
        // the normal case while a 3-byte em dash is still being accumulated.
        if (!isIncomplete(bytes)) break
        j += 1
        continue
      }
      if ([...decoded].some((c) => c.codePointAt(0) > 0x7f)) {
        best = { start, end: j + 1, decoded, found: chars.join('') }
      }
      j += 1
    }
    if (best) {
      spans.push(best)
      i = best.end
    } else {
      i += 1
    }
  }
  return spans
}

// A trailing lead byte or a short sequence is "incomplete", not invalid.
function isIncomplete(bytes) {
  if (bytes.length >= 4) return false
  const lead = bytes[0]
  if (lead < 0xc2 || lead > 0xf4) return false
  const needed = lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
  return bytes.length < needed
}

const BOM16LE = [0xff, 0xfe]
const BOM16BE = [0xfe, 0xff]

const startsWith = (buf, bytes) => bytes.every((b, i) => buf[i] === b)

// UTF-16 without a BOM is still recognisable: every ASCII code unit leaves a
// NUL in the high byte, so a NUL-dense file that decodes as "ASCII with stray
// NULs" is UTF-16 in practice.
function looksLikeUtf16(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 512))
  if (sample.length < 4) return null
  let evenNul = 0
  let oddNul = 0
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) (i % 2 === 0 ? (evenNul += 1) : (oddNul += 1))
  }
  const pairs = Math.floor(sample.length / 2)
  if (pairs === 0) return null
  if (oddNul / pairs > 0.4 && evenNul / pairs < 0.1) return 'UTF-16LE (no BOM)'
  if (evenNul / pairs > 0.4 && oddNul / pairs < 0.1) return 'UTF-16BE (no BOM)'
  return null
}

function walkFiles() {
  if (!SCAN_ALL) {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
    return out.toString('utf8').split('\0').filter(Boolean).map((f) => path.join(ROOT, f))
  }
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(path.join(dir, entry.name))
      } else {
        files.push(path.join(dir, entry.name))
      }
    }
  }
  walk(ROOT)
  return files
}

const files = walkFiles().filter((f) => {
  if (BINARY_EXT.has(path.extname(f).toLowerCase())) return false
  try {
    return fs.statSync(f).isFile()
  } catch {
    return false // tracked in git but deleted from the working tree
  }
})

const mojibake = new Map()
const invalidUtf8 = []
const utf16 = []
const replacement = []
const bomFiles = []
const controlBytes = []
let fixed = 0

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const buf = fs.readFileSync(file)

  if (startsWith(buf, BOM16LE)) { utf16.push([rel, 'UTF-16LE']); continue }
  if (startsWith(buf, BOM16BE)) { utf16.push([rel, 'UTF-16BE']); continue }
  const bom = startsWith(buf, [0xef, 0xbb, 0xbf]) ? buf.subarray(0, 3) : Buffer.alloc(0)
  if (bom.length > 0) bomFiles.push(rel)
  const body = bom.length > 0 ? buf.subarray(3) : buf

  const bomless16 = looksLikeUtf16(body)
  if (bomless16) utf16.push([rel, bomless16])
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch (err) {
    invalidUtf8.push([rel, err.message])
    text = body.toString('utf8')
  }

  const fffd = (text.match(/\ufffd/g) ?? []).length
  if (fffd > 0) replacement.push([rel, fffd])

  const ctrl = new Map()
  for (const ch of text) {
    const o = ch.codePointAt(0)
    const isCtrl = (o < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r') || (o >= 0x80 && o <= 0x9f)
    if (isCtrl) ctrl.set(`U+${o.toString(16).toUpperCase().padStart(4, '0')}`, (ctrl.get(`U+${o.toString(16).toUpperCase().padStart(4, '0')}`) ?? 0) + 1)
  }
  if (ctrl.size > 0) controlBytes.push([rel, Object.fromEntries(ctrl)])

  const spans = findSpans(text)
  if (spans.length === 0) continue
  mojibake.set(rel, spans.map((s) => [text.slice(0, s.start).split('\n').length, s.found, s.decoded]))

  if (FIX) {
    let out = ''
    let at = 0
    for (const s of spans) {
      out += text.slice(at, s.start) + s.decoded
      at = s.end
    }
    out += text.slice(at)
    fs.writeFileSync(file, Buffer.concat([bom, Buffer.from(out, 'utf8')]))
    fixed += 1
  }
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
const show = (s) => JSON.stringify(s)

console.log('='.repeat(78))
console.log(`TEXT ENCODING CHECK  files=${files.length}  mode=${SCAN_ALL ? 'working-tree' : 'git-tracked'}${FIX ? '  FIX' : ''}`)
console.log('='.repeat(78))

console.log(`\n[1] MOJIBAKE: ${mojibake.size} file(s), ${[...mojibake.values()].reduce((n, v) => n + v.length, 0)} span(s)`)
for (const [f, spans] of [...mojibake].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${f}  (${spans.length} span(s))`)
  for (const [line, found, decoded] of spans.slice(0, 40)) {
    console.log(`        L${line}: ${show(found)} -> ${show(decoded)}`)
  }
  if (spans.length > 40) console.log(`        ... ${spans.length - 40} more`)
}
if (FIX && fixed > 0) console.log(`    repaired ${fixed} file(s)`)

console.log(`\n[2] INVALID UTF-8: ${invalidUtf8.length}`)
for (const [f, e] of invalidUtf8) console.log(`    ${f}: ${e}`)

console.log(`\n[3] UTF-16 FILES (expected UTF-8): ${utf16.length}`)
for (const [f, e] of utf16) console.log(`    ${f}: ${e}`)

console.log(`\n[4] U+FFFD REPLACEMENT CHARS: ${replacement.length}`)
for (const [f, n] of replacement) console.log(`    ${f}: ${n}`)

console.log(`\n[5] C1/CONTROL BYTES IN TEXT: ${controlBytes.length}`)
for (const [f, c] of controlBytes) console.log(`    ${f}: ${show(c)}`)

console.log(`\n[6] UTF-8 BOM: ${bomFiles.length}`)
for (const f of bomFiles) console.log(`    ${f}`)

const failed = !FIX && (mojibake.size > 0 || invalidUtf8.length > 0 || replacement.length > 0)
process.exit(failed ? 1 : 0)
