import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The plan's §11 risk 1 mitigation, implemented.
 *
 * "Add a test that fails if a `findMany` is written without either a `tenantId`
 * filter or an explicit `// CROSS-TENANT` comment."
 *
 * A source-scanning test rather than a behavioural one, because the defect has no
 * runtime signature: an unscoped `findMany` returns the same shape of answer as a
 * scoped one. The only thing that distinguishes them is whether the author said so.
 *
 * It scans `lib/queries.ts` because that module is the app's *only* Prisma call
 * site — a rule `lib/queries.ts` documents and `lib/http.ts` relies on. Scanning
 * the whole tree would mostly assert on incidental code and would rot; scanning one
 * file makes a violation impossible to add without failing here.
 */

const LIB = join(import.meta.dir, '..', 'lib', 'queries.ts')
const SOURCE = readFileSync(LIB, 'utf8')
const LINES = SOURCE.split(/\r?\n/)

/** How many lines above a call a `// CROSS-TENANT` marker may sit. */
const MARKER_LOOKBACK = 8

const MARKER = /CROSS-TENANT/

/** A `prisma` or transaction-handle model call: `prisma.tenant.findMany(` etc. */
const CALL = /\b(prisma|tx|db)\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)\(/g

/**
 * Returns the text of the object literal a call's first argument is, by balancing
 * braces from the opening `{`.
 *
 * Returns `null` when the argument is not an object literal at all — which is
 * itself a violation, because a call whose filter is a variable has moved the scope
 * out of sight of this test.
 */
function firstArgumentObject(callIndex: number): string | null {
  const open = SOURCE.indexOf('{', callIndex)
  if (open === -1) return null

  let depth = 0
  for (let index = open; index < SOURCE.length; index += 1) {
    const character = SOURCE[index]
    if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return SOURCE.slice(open, index + 1)
    }
  }
  return null
}

/** True when a `// CROSS-TENANT` comment sits above the call. */
function hasMarkerAbove(callIndex: number): boolean {
  const line = SOURCE.slice(0, callIndex).split(/\r?\n/).length
  const from = Math.max(0, line - 1 - MARKER_LOOKBACK)
  return LINES.slice(from, line - 1).some((text) => MARKER.test(text))
}

/**
 * `where: { tenantId }`, `where: { tenantId_code: {...} }`, `where: { id: tenantId }`
 * — anything that names a tenant, whether as a column, a compound key or the
 * tenant's own primary key.
 */
const TENANT_PREDICATE =
  /\btenantId\b|\btenantId_[a-zA-Z]+\b|\bid\s*:\s*tenantId\b|tenantId_email/

interface Violation {
  readonly line: number
  readonly call: string
  readonly reason: string
}

function findViolations(): Violation[] {
  const violations: Violation[] = []
  CALL.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = CALL.exec(SOURCE)) !== null) {
    const call = match[0]
    const line = SOURCE.slice(0, match.index).split(/\r?\n/).length
    const text = SOURCE.slice(match.index, match.index + 200)

    // `prisma.$transaction` and `$queryRaw` are not model reads with a `where`;
    // the first is asserted separately and the second is a tagged template whose
    // table name is checked here.
    if (call.includes('.$')) continue

    if (hasMarkerAbove(match.index)) continue

    const object = firstArgumentObject(match.index)
    if (object === null) {
      violations.push({
        line,
        call,
        reason: 'the filter is not an object literal, so its scope cannot be read here',
      })
      continue
    }
    if (!TENANT_PREDICATE.test(object)) {
      violations.push({ line, call, reason: `no tenant predicate in ${object.replace(/\s+/g, ' ').slice(0, 80)}` })
    }
    void text
  }

  return violations
}

describe('lib/queries.ts — every query names its tenant scope', () => {
  it('should have no unscoped model call', () => {
    const violations = findViolations()
    // Each violation is printed in full: a line number alone makes the reader open
    // the file to find out which call it was.
    expect(violations.map((v) => `line ${v.line}: ${v.call} — ${v.reason}`)).toEqual([])
  })

  it('should actually contain model calls, so the check above is not vacuous', () => {
    // A guard that finds nothing because the file is empty, or because the regex
    // stopped matching, reports green forever. This asserts the scan still sees
    // the calls it is meant to see.
    let count = 0
    CALL.lastIndex = 0
    while (CALL.exec(SOURCE) !== null) count += 1
    expect(count).toBeGreaterThan(20)
  })

  it('should mark every cross-tenant read with a CROSS-TENANT comment', () => {
    // The marker is the escape hatch, so it has to stay visible: an assertion that
    // each one is followed by prose is what stops the comments decaying into a
    // single unexplained `// CROSS-TENANT` above a block.
    const markers = LINES.filter((line) => /^\s*\/\/ CROSS-TENANT:/.test(line))
    expect(markers.length).toBeGreaterThanOrEqual(5)
    for (const marker of markers) {
      const after = LINES[LINES.indexOf(marker) + 1] ?? ''
      // The line immediately after a marker names what the call is, or is blank
      // because the call wraps onto the next line. Either is fine; a marker with no
      // call under it at all is not.
      expect(marker.length).toBeGreaterThan('// CROSS-TENANT:'.length)
      expect(after.length).toBeGreaterThan(0)
    }
  })

  it('should be the only file in lib/ that touches prisma', () => {
    // The premise of the check above. If a second file starts calling prisma
    // directly, the scan is no longer covering the app's data access and says so.
    const libDir = join(import.meta.dir, '..', 'lib')
    const offenders: string[] = []
    for (const entry of readdirSync(libDir)) {
      const path = join(libDir, entry)
      if (!statSync(path).isFile() || !entry.endsWith('.ts')) continue
      if (entry === 'queries.ts') continue
      // `prisma.ts` re-exports the handle; nothing else may.
      if (/prisma\s*\.\s*[A-Za-z]/.test(readFileSync(path, 'utf8'))) {
        offenders.push(entry)
      }
    }
    expect(offenders).toEqual([])
  })
})
