#!/usr/bin/env node
/**
 * Run every test file under `tests/` in its own process.
 *
 * Why not `bun test tests`: all files share one module registry and one mock
 * registry, and ~20 files register `mock.module` doubles at their own module
 * scope with no restore. Which double a route captures is decided by file
 * evaluation order, so the suite is order-dependent — some files only pass
 * after others have run — and one pathological order hangs the whole process
 * for ever at teardown (a real Prisma client captured before the harness's mock
 * is registered, dialling Neon on the first query and never resolving).
 *
 * Per-file processes make the load order irrelevant: every file starts from a
 * clean registry, which is what its own module-scope registrations assume. The
 * cost is one process start per file; the benefit is a suite that is green or
 * red for reasons that live in the file it names.
 *
 * Usage: node tests/run-files.mjs [--filter <substring>]
 * Exit code: 0 when every file passes, 1 otherwise.
 */
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const filterIndex = process.argv.indexOf('--filter')
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1] : null

const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => (filter ? name.includes(filter) : true))
  .sort()

if (files.length === 0) {
  console.error(`run-files: no test files match ${filter ? `"${filter}"` : 'the directory'}`)
  process.exit(1)
}

let pass = 0
let fail = 0
const failures = []

for (const file of files) {
  const result = spawnSync(
    'bun',
    ['test', '--preload', './tests/preload.ts', `tests/${file}`],
    { cwd: join(here, '..'), encoding: 'utf8' }
  )

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const passMatch = output.match(/^\s*(\d+) pass$/m)
  const failMatch = output.match(/^\s*(\d+) fail$/m)
  const filePass = passMatch ? Number(passMatch[1]) : 0
  const fileFail = failMatch ? Number(failMatch[1]) : 0

  pass += filePass
  fail += fileFail

  const detail = fileMatch(output, file)
  if (result.status !== 0 || fileFail > 0) {
    failures.push(`${file}${detail ? `\n${detail}` : ''}`)
  }
}

for (const failure of failures) {
  console.error(`FAIL ${failure}`)
}

console.log(`\nrun-files: ${pass} pass, ${fail} fail across ${files.length} files`)
process.exit(failures.length > 0 ? 1 : 0)

/** The first `(fail)` line of a file's output, so a failure names its test. */
function fileMatch(output, file) {
  for (const line of output.split('\n')) {
    if (line.includes(': (fail)')) return line.trim()
  }
  return ''
}
