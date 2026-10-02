// Unit checks for tools/check-text-encoding.mjs.
//
// Run: bun run check:encoding:test
//
// Fixtures are rebuilt in a fresh temp directory on every run, so the suite is
// repeatable: an earlier run's --fix cannot make a later run pass vacuously.
//
// Mojibake is produced by actually corrupting correct UTF-8, never by typing the
// corrupted characters by hand. Hand-written mojibake silently gets the byte
// order wrong, which is how this test file previously tested the wrong thing.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, 'check-text-encoding.mjs')

// What a mis-decode produced: the cp1252 characters for bytes 0x80-0x9F, and
// latin-1 elsewhere. Mirrors CP1252_HIGH in the checker.
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x008b, 0x0178, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x009b, 0x0153, 0x009d, 0x017e, 0x009f,
]

/** Decode UTF-8 bytes as if they were cp1252. This is the corruption itself. */
function corrupt(text) {
  return [...Buffer.from(text, 'utf8')]
    .map((b) => (b >= 0x80 && b <= 0x9f ? String.fromCodePoint(CP1252_HIGH[b - 0x80]) : String.fromCharCode(b)))
    .join('')
}

// Every glyph below round-trips through the corruption and back.
const CORRECT = [
  'em dash — end',
  'quotes “left” and “right”',
  'arrow → and box ├───┬─┘',
  'ticks ✅ ❌ ✔ ✗',
  'currency €100',
  'diacritics Crèche Ångström',
  'section §  spaced nbsp',
  'latin1 café naïve',
].join('\n')

// Legitimate non-ASCII that must never be reported as mojibake.
const LEGIT =
  '// em dash — arrow → cjk 日本 box └──┘ ✔ ❌ ✅ Twi Ɛ Ɔ Ɖ ဍ Cyrillic Привет\n'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-check-'))
fs.writeFileSync(path.join(dir, 'moji.md'), corrupt(`// ${CORRECT}\n`), 'utf8')
fs.writeFileSync(path.join(dir, 'legit.md'), LEGIT, 'utf8')
fs.writeFileSync(
  path.join(dir, 'bom.ts'),
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('export const a = 1\n')]),
)
fs.writeFileSync(path.join(dir, 'u16-bom.sql'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('SELECT 1;\n', 'utf16le')]))
fs.writeFileSync(path.join(dir, 'u16-nobom.sql'), Buffer.from('SELECT 1;\n', 'utf16le'))
fs.writeFileSync(path.join(dir, 'invalid.md'), Buffer.from([0x66, 0xff, 0xfe, 0x0a]))

const scan = (extra = []) => {
  try {
    return execFileSync('node', [script, '--all', ...extra], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    return err.stdout ?? '' // exit 1 when findings exist is expected
  }
}

const checks = []
const check = (name, fn) => checks.push([name, fn])

check('reports mojibake and recovers the original text exactly', () => {
  const report = scan()
  assert.match(report, /MOJIBAKE: 1 file\(s\)/)
  // --fix then has to reproduce CORRECT byte-for-byte.
  execFileSync('node', [script, '--all', '--fix'], { cwd: dir, stdio: 'ignore' })
  const repaired = fs.readFileSync(path.join(dir, 'moji.md'), 'utf8')
  assert.equal(repaired, `// ${CORRECT}\n`, 'round-trip must be exact')
  assert.equal(repaired.includes('\ufffd'), false, 'no replacement characters')
  assert.match(scan(), /MOJIBAKE: 0 file\(s\)/, 'clean after --fix')
})

check('never flags legitimate non-ASCII', () => {
  assert.doesNotMatch(scan(), /legit\.md/)
})

check('detects UTF-16 with a BOM', () => {
  assert.match(scan(), /u16-bom\.sql: UTF-16LE/)
})

check('detects UTF-16 without a BOM', () => {
  assert.match(scan(), /u16-nobom\.sql: UTF-16LE \(no BOM\)/)
})

check('detects invalid UTF-8', () => {
  assert.match(scan(), /INVALID UTF-8: 1/)
  assert.match(scan(), /invalid\.md/)
})

check('detects a UTF-8 BOM', () => {
  assert.match(scan(), /UTF-8 BOM: 1/)
  assert.match(scan(), /bom\.ts/)
})

check('--fix preserves a BOM rather than silently dropping it', () => {
  const bytes = fs.readFileSync(path.join(dir, 'bom.ts'))
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(bytes.toString('utf8'), '\ufeffexport const a = 1\n')
})

check('--fix leaves legitimate non-ASCII untouched', () => {
  assert.equal(fs.readFileSync(path.join(dir, 'legit.md'), 'utf8'), LEGIT)
})

check('--fix is idempotent', () => {
  const before = fs.readFileSync(path.join(dir, 'moji.md'))
  execFileSync('node', [script, '--all', '--fix'], { cwd: dir, stdio: 'ignore' })
  assert.deepEqual(fs.readFileSync(path.join(dir, 'moji.md')), before)
})

check('exit code is non-zero on findings and zero when clean', () => {
  const run = () => {
    try {
      execFileSync('node', [script, '--all'], { cwd: dir, stdio: 'ignore' })
      return 0
    } catch (err) {
      return err.status
    }
  }
  assert.equal(run(), 1, 'must fail while invalid.md and the UTF-16 files remain')
  for (const f of ['invalid.md', 'u16-bom.sql', 'u16-nobom.sql', 'bom.ts']) {
    fs.rmSync(path.join(dir, f))
  }
  assert.equal(run(), 0, 'must pass once only findings are removed')
})

let failed = 0
for (const [name, fn] of checks) {
  try {
    fn()
    console.log(`  ok   ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  FAIL ${name}`)
    for (const line of String(err.message).split('\n').slice(0, 6)) {
      console.error(`       ${line}`)
    }
  }
}
fs.rmSync(dir, { recursive: true, force: true })

console.log(`\ncheck-text-encoding: ${checks.length - failed}/${checks.length} passed`)
process.exit(failed === 0 ? 0 : 1)