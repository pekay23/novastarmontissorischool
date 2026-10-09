// `./harness` first: the resolved-`where` table below reaches the database through
// `@/lib/queries`, so the Prisma mock has to be registered before that module
// loads. See the harness docstring and `bunfig.toml`, which preloads it so the
// mock cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mocks, resetHarness } from './harness'

/**
 * The plan's §11 risk 1 mitigation, in two layers.
 *
 * The rule is that every Prisma call in the control plane either names a tenant in
 * its `where` or carries an explicit `// CROSS-TENANT` comment saying why not.
 *
 * Layer one is a source scan of `lib/queries.ts`, because the defect has no runtime
 * signature at the *authoring* stage: an unscoped `findMany` returns the same shape
 * of answer as a scoped one. Scanning one file rather than the whole tree is what
 * makes the check meaningful.
 *
 * Layer two is the load-bearing one, and it exists because layer one is decidable
 * only syntactically. The scan can see that the token `tenantId` appears somewhere
 * in a call's argument object; it cannot see that the token landed inside `where`
 * rather than inside `select`, nor that a `where: { id: { not: tenantId } }` is
 * scoped to the one tenant the caller did *not* name. A check that only greps for a
 * token passes against all three. So every scoped query below is also executed and
 * its resolved `where` compared with `toEqual`, which is what actually makes
 * removing a tenant predicate fail.
 */

const {
  auditForTenant,
  getSchoolInTenant,
  getTenantById,
  listSchoolsForTenant,
  listUsersForTenant,
  setTenantActive,
  updateTenantFields,
  writeTenantSetting,
} = await import('@/lib/queries')

const LIB = join(import.meta.dir, '..', 'lib', 'queries.ts')
const SOURCE = readFileSync(LIB, 'utf8')
const LINES = SOURCE.split(/\r?\n/)



/**
 * A `CROSS-TENANT` marker comment, in either the line-comment or the block-comment
 * form — and nothing else.
 *
 * ONE pattern, used by both the scanner's exemption below and the counting test
 * further down. They previously used different ones: the exemption matched the bare
 * word anywhere on a line while the count only recognised real `// CROSS-TENANT:`
 * comments. That let a prose sentence mentioning "cross-tenant" stand in for a
 * marker on a call the count never saw — so the two disagreed about the same set of
 * lines, and the looser one decided who was exempt. Anchored to a comment introducer
 * so prose cannot substitute.
 */
const MARKER = /^\s*(?:\/\/|\*)\s*CROSS-TENANT\b/

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

/** True when a `CROSS-TENANT` marker explicitly sanctions this call.

The marker must sit on the same line as the call or on the nearest preceding
marker line. It is not enough for a marker to exist somewhere above the call:
a marker for a different call must not vouch for one it does not sit above.

The rule is:
  - a trailing `// CROSS-TENANT:` on the call's own line always exempts;
  - otherwise the nearest marker line above the call exempts it only if no
    other Prisma model call sits between that marker and the call.
A long docstring between the marker and the call does not break the exemption,
because no Prisma call is inside the docstring. A marker placed for call A
cannot exempt call B that appears after another call between them. */
function hasMarkerForCall(
  source: string,
  lines: string[],
  callMatch: RegExpExecArray,
): boolean {
  const callIndex = callMatch.index
  const callLine = source.slice(0, callIndex).split(/\r?\n/).length

  const callLineText = lines[callLine - 1] ?? ''
  if (/\/\/\s*CROSS-TENANT\b/.test(callLineText)) return true

  let nearestMarkerLine = -1
  for (let i = callLine - 2; i >= 0; i--) {
    if (MARKER.test(lines[i])) { nearestMarkerLine = i + 1; break }
  }
  if (nearestMarkerLine === -1) return false

  let nearestOtherCallLine = -1
  CALL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CALL.exec(source)) !== null) {
    if (m.index >= callIndex) break
    nearestOtherCallLine = source.slice(0, m.index).split(/\r?\n/).length
  }

  return nearestOtherCallLine === -1 || nearestMarkerLine > nearestOtherCallLine
}

/**
 * `where: { tenantId }`, `where: { tenantId_code: {...} }`, `where: { id: tenantId }`
 * — anything that names a tenant, whether as a column, a compound key or the
 * tenant's own primary key.
 *
 * Deliberately coarse, and coarse on its own terms: it answers "does this call
 * *mention* a tenant", which is a question about intent rather than about the query
 * that gets run. It is a net for a newly added call. Whether the predicate is
 * actually the tenant scope is settled below by comparing resolved `where` objects.
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

    // `prisma.$transaction` and `$queryRaw` are not model reads with a `where`;
    // the first is asserted separately and the second is a tagged template whose
    // table name is checked here.
    if (call.includes('.$')) continue

    if (hasMarkerForCall(SOURCE, LINES, match)) continue

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
  }

  return violations
}

// ---------------------------------------------------------------------------
// The resolved `where`, which is what actually runs
// ---------------------------------------------------------------------------

/**
 * A tenant id and a school id that appear in no cookie and no fixture elsewhere, so
 * an assertion that names them cannot be satisfied by a value the harness supplied
 * by accident.
 */
const TENANT_ID = 'tenant-scope-alpha'
const OTHER_TENANT_ID = 'tenant-scope-beta'
const SCHOOL_ID = 'school-scope-alpha'

const TENANT_ROW = {
  id: TENANT_ID,
  name: 'Scope Montessori',
  code: 'scope-alpha',
  domain: null,
  isActive: true,
  settings: { currency: 'GHS' },
  createdAt: new Date('2026-01-02T08:00:00.000Z'),
  updatedAt: new Date('2026-02-03T08:00:00.000Z'),
  _count: { schools: 1, users: 2 },
}

const MUTATION_CONTEXT = {
  operatorId: 'operator-scope-alpha',
  operatorEmail: 'ops@novastar.test',
  ipAddress: null,
  userAgent: null,
}

/**
 * Answers the tenant reads on their own predicate, so a query that widened or
 * inverted its `where` misses here instead of passing for the right reason.
 */
function givenTenantRow(): void {
  mocks.tenantFindFirst.mockImplementation(async (args) =>
    args.where?.id === TENANT_ID ? TENANT_ROW : null,
  )
  mocks.tenantUpdate.mockImplementation(async () => TENANT_ROW)
}

beforeEach(() => {
  resetHarness()
})

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
    // The marker is the escape hatch, so it has to stay visible. Each one is
    // required to say *why* — a bare `// CROSS-TENANT` above a block is exactly the
    // decay this asserts against. Counted with the same pattern the scanner's
    // exemption uses, so the two can never disagree about which lines are markers.
    const indexes: number[] = []
    LINES.forEach((text, index) => {
      if (MARKER.test(text)) indexes.push(index)
    })

    expect(indexes.length).toBeGreaterThanOrEqual(5)
    for (const index of indexes) {
      const marker = LINES[index]
      const reason = marker.slice(marker.indexOf('CROSS-TENANT') + 'CROSS-TENANT'.length)
      expect(reason.replace(/^[:\s-]+/, '').length).toBeGreaterThan(0)
    }
  })

  it('should be the only file in lib/ that touches prisma', () => {
    // The premise of the check above. If a second file starts calling prisma
    // directly, the scan is no longer covering the app's data access and says so.
    //
    // ADR-024 merged the portal, public site and super-admin console into one app,
    // which added direct prisma callers for auth, tenant context, visibility and
    // platform config. Those are listed here with the reason each is allowed to
    // reach the handle directly rather than through `queries.ts`:
    //
    // - `auth.ts` — NextAuth's `authorize` runs before any tenant context exists,
    //   and the user lookup is by primary key from a session token, not by tenant.
    // - `tenant.ts` — `getTenantContext` resolves the session user to a row by id;
    //   it is the *input* to tenant scoping, not a consumer of it.
    // - `visibility.ts` — resolves a role's row-level scope; reads staff/parent by
    //   `tenantId + userId`, so it is scoped and asserted separately.
    // - `system-errors.ts` — platform-level error logging; no tenant to scope to.
    // - `system-config.ts` — platform-level config; no tenant to scope to.
    // - `data.ts` — public-site content (branding, news, events); scoped by
    //   `tenantId` and asserted separately.
    // - `amendments.ts` — dead code, only imported by a test file.
    const libDir = join(import.meta.dir, '..', 'lib')
    const allowed = new Set([
      'auth.ts',
      'tenant.ts',
      'visibility.ts',
      'system-errors.ts',
      'system-config.ts',
      'data.ts',
      'amendments.ts',
    ])
    const offenders: string[] = []
    for (const entry of readdirSync(libDir)) {
      const path = join(libDir, entry)
      if (!statSync(path).isFile() || !entry.endsWith('.ts')) continue
      if (entry === 'queries.ts') continue
      // Comments stripped first: `lib/prisma.ts` documents that `lib/queries.ts` is
      // the only call site, and prose about prisma must not read as a call to it.
      // `prisma.ts` re-exports the handle; nothing else may reach through it.
      if (allowed.has(entry)) continue
      if (/\bprisma\s*\.\s*[$A-Za-z_]/.test(withoutComments(readFileSync(path, 'utf8')))) {
        offenders.push(entry)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('lib/queries.ts — every scoped query resolves to the tenant it was given', () => {
  it('should scope the tenant detail read on the tenant primary key', async () => {
    givenTenantRow()

    const tenant = await getTenantById(TENANT_ID)

    // `toEqual`, not `toContain`: `where: {}`, `where: { id: { not: tenantId } }`
    // and `where: { code: tenantId }` all "mention" the right answer to a substring
    // check and none of them is the query this function promises.
    expect(mocks.tenantFindFirst.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(tenant?.id).toBe(TENANT_ID)
  })

  it('should scope the school list on the tenant column', async () => {
    await listSchoolsForTenant(TENANT_ID)

    expect(mocks.schoolFindMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT_ID })
  })

  it('should scope the user directory on the tenant column', async () => {
    await listUsersForTenant(TENANT_ID)

    expect(mocks.userFindMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT_ID })
  })

  it('should scope a school lookup on the tenant as well as the school', async () => {
    // The school id is caller-supplied, so this is the predicate that stops a
    // request naming a school in another tenant from resolving to a row.
    mocks.schoolFindFirst.mockImplementation(async (args) =>
      args.where?.id === SCHOOL_ID && args.where?.tenantId === TENANT_ID
        ? { id: SCHOOL_ID, tenantId: TENANT_ID, name: 'Scope School' }
        : null,
    )

    const school = await getSchoolInTenant(TENANT_ID, SCHOOL_ID)

    expect(mocks.schoolFindFirst.mock.calls[0][0].where).toEqual({
      id: SCHOOL_ID,
      tenantId: TENANT_ID,
    })
    expect(school).toEqual({ id: SCHOOL_ID, tenantId: TENANT_ID, name: 'Scope School' })

    // And the negative, which is the half a `where: { id: schoolId }` cannot pass:
    // the same school id against another tenant is a miss, not a row the caller
    // turns into a 404 one line later.
    expect(await getSchoolInTenant(OTHER_TENANT_ID, SCHOOL_ID)).toBeNull()
    expect(mocks.schoolFindFirst.mock.calls[1][0].where).toEqual({
      id: SCHOOL_ID,
      tenantId: OTHER_TENANT_ID,
    })
  })

  it('should scope both halves of the tenant audit trail', async () => {
    await auditForTenant(TENANT_ID, { take: 25, skip: 0 })

    expect(mocks.auditFindMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT_ID })
    expect(mocks.auditCount.mock.calls[0][0].where).toEqual({ tenantId: TENANT_ID })
  })

  it('should scope the mutable-field write to the tenant it was given', async () => {
    givenTenantRow()

    const updated = await updateTenantFields(
      TENANT_ID,
      { name: 'Scope Montessori Renamed', domain: null },
      MUTATION_CONTEXT,
    )

    // Both statements: the read that supplies the audit entry's `from`, and the
    // write itself. A write scoped to `{ id: { not: tenantId } }` reaches every
    // other tenant and is caught here.
    expect(mocks.tenantFindFirst.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({
      name: 'Scope Montessori Renamed',
      domain: null,
    })
    expect(updated?.tenant.id).toBe(TENANT_ID)
    // And the entry is filed on the same tenant, or the write is unattributable.
    expect((mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>).tenantId).toBe(
      TENANT_ID,
    )
  })

  it('should scope the suspension write to the tenant it was given', async () => {
    givenTenantRow()

    await setTenantActive(TENANT_ID, false, MUTATION_CONTEXT)

    expect(mocks.tenantFindFirst.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(mocks.tenantUpdate.mock.calls[0][0].data).toEqual({ isActive: false })
  })

  it('should scope the settings write to the tenant it was given', async () => {
    givenTenantRow()

    await writeTenantSetting(TENANT_ID, ['timezone'], 'Africa/Accra', MUTATION_CONTEXT)

    expect(mocks.tenantFindFirst.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect(mocks.tenantUpdate.mock.calls[0][0].where).toEqual({ id: TENANT_ID })
    expect((mocks.auditCreate.mock.calls[0][0].data as Record<string, unknown>).tenantId).toBe(
      TENANT_ID,
    )
  })
})

describe('CROSS-TENANT marker matching — pure helper mutations', () => {
  function violationsIn(source: string): string[] {
    const lines = source.split(/\r?\n/)
    const callRe = /\b(prisma|tx|db)\.([A-Za-z][A-Za-z0-9]*)\.([A-Za-z][A-Za-z0-9]*)\(/g
    const results: string[] = []
    let m: RegExpExecArray | null
    while ((m = callRe.exec(source)) !== null) {
      if (m[0].includes('.$')) continue
      const open = source.indexOf('{', m.index)
      let obj: string | null = null
      if (open !== -1) {
        let depth = 0
        for (let i = open; i < source.length; i++) {
          if (source[i] === '{') depth++
          else if (source[i] === '}') {
            depth--
            if (depth === 0) { obj = source.slice(open, i + 1); break }
          }
        }
      }
      if (obj === null || !/\btenantId\b/.test(obj)) {
        if (!hasMarkerForCall(source, lines, m)) results.push(m[0])
      }
    }
    return results
  }

  it('exempts a call whose marker is directly above with no other calls between', () => {
    expect(violationsIn(`// CROSS-TENANT: fleet-wide
prisma.tenant.findMany({ select: { id: true } })
`)).toEqual([])
  })

  it('exempts a call whose marker is a trailing comment on the same line', () => {
    expect(violationsIn(`prisma.tenant.findMany({ select: { id: true } })  // CROSS-TENANT: reason
`)).toEqual([])
  })

  it('does not let a long docstring expire the marker', () => {
    const lines = Array.from({ length: 20 }, (_, i) => ` * line ${i}`).join('\n')
    const src = `/**\n${lines}\n */\n// CROSS-TENANT: still exempt\nprisma.tenant.findMany({ select: { id: true } })\n`
    expect(violationsIn(src)).toEqual([])
  })

  it('does not let a marker for one call vouch for a later call', () => {
    const src = `// CROSS-TENANT: for the first call only
prisma.tenant.findMany({ select: { id: true } })
prisma.school.findMany({ select: { id: true } })
`
    expect(violationsIn(src)).toEqual(['prisma.school.findMany('])
  })

  it('does not let an 8-line window vouch for a call it does not sanction', () => {
    const src = `// CROSS-TENANT: for call A
prisma.tenant.findMany({ select: { id: true } })
line1
line2
line3
line4
line5
prisma.school.findMany({ select: { id: true } })
`
    expect(violationsIn(src)).toEqual(['prisma.school.findMany('])
  })

  it('does not let a marker in one function vouch for a call in the next', () => {
    const src = `function a() {
  // CROSS-TENANT: for a's call
  prisma.tenant.findMany({ select: { id: true } })
}
function b() {
  prisma.school.findMany({ select: { id: true } })
}
`
    expect(violationsIn(src)).toEqual(['prisma.school.findMany('])
  })
})

/** Comments removed, so prose about a call cannot masquerade as the call. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // The `[^:]` guard keeps a `//` inside a URL (`https://`) from eating the
    // remainder of the line.
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}
