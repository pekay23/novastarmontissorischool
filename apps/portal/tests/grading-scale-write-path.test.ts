import { describe, it, expect, afterAll, beforeEach, mock, spyOn } from 'bun:test'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertBandsCoverZeroToHundred,
  findGradeBandCoverageGaps,
  findGradeBandDefects,
  gradeBandWriteProblems,
  gradingScaleBandWriteRule,
  computeAcademicSummary,
  resolveGradeBand,
  type GradeBand,
  type NamedGradeBand,
} from '@novastar/shared-utils'
import { ENTITY_CONFIG_MAP } from '@novastar/shared-types'

/**
 * A scale that cannot grade is refused where it is written, not discovered on a
 * report card.
 *
 * The defect: a school admin edited its seeded Ghana Primary scale and mistyped
 * one boundary from 65 to 66. Nothing rejected the write — the only coverage
 * check in the codebase ran inside the seed, which never runs again — and every
 * child scoring exactly 65 was silently reported in the band BELOW, because a
 * percentage no band claims fell through to "the nearest band beneath".
 *
 * Two halves are proved here, and they are different claims:
 *
 * 1. the WRITE PATH refuses a scale it would leave mis-gradeable, judged across
 *    every band of the scale rather than against the row alone (a band is never
 *    exhaustive on its own). Driven through the real route handlers with a mocked
 *    Prisma, so what is asserted is the HTTP answer a school admin gets, not a
 *    helper called in isolation.
 * 2. RESOLUTION refuses to invent a band. A malformed scale must never produce a
 *    confident wrong label, whatever got past the write path — an older database,
 *    a direct SQL edit, a partially-applied migration.
 */

// ---------------------------------------------------------------------------
// The seeded Ghana Primary bands, as a school has them
// ---------------------------------------------------------------------------

/**
 * A stored band, shaped as `computeAcademicSummary` wants it.
 *
 * `id` rides along because the cross-row rule has to tell "the row being edited"
 * from its neighbours, which is the whole reason a scale is judged across its rows
 * rather than one band at a time.
 */
type TestBand = GradeBand & { id?: string | null }

const band = (
  key: string,
  minScore: number,
  maxScore: number,
  label: string,
  id?: string,
): TestBand => ({
  id,
  key,
  label,
  minScore,
  maxScore,
  color: '#047857',
  order: 0,
  description: null,
})

const PRIMARY: TestBand[] = [
  band('level_6', 85, 100, 'Level 6', 'b6'),
  band('level_5', 70, 84, 'Level 5', 'b5'),
  band('level_4', 60, 69, 'Level 4', 'b4'),
  band('level_3', 50, 59, 'Level 3', 'b3'),
  band('level_2', 40, 49, 'Level 2', 'b2'),
  band('level_1', 0, 39, 'Level 1', 'b1'),
]

/** The band key a percentage is reported under, or null when no band holds it. */
const keyFor = (bands: readonly NamedGradeBand[], percentage: number): string | null =>
  resolveGradeBand(percentage, bands)?.key ?? null

// ---------------------------------------------------------------------------
// Session / auth / Prisma, mocked at the boundary
// ---------------------------------------------------------------------------

class MockUnauthorizedError extends Error {
  constructor() {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
  }
}

class MockForbiddenError extends Error {
  constructor() {
    super('Forbidden')
    this.name = 'ForbiddenError'
  }
}

class MockServerConfigError extends Error {
  constructor() {
    super('Server config unavailable')
    this.name = 'ServerConfigError'
  }
}

/**
 * The caller's scope. `schoolId` is nullable because a tenant-level admin has
 * none, and the tests below need to be one — the ownership predicate has to
 * behave differently for that caller, not merely refuse everything.
 */
const tenantContext: { tenantId: string; schoolId: string | null; userId: string } = {
  tenantId: 'tenant-1',
  schoolId: 'school-1',
  userId: 'user-1',
}
let permissionGranted = true

// Captured before the first `mock.module` below, so it is the namespace this file
// replaces rather than its own factory. Registered with the rest further down.
const actualAuth = await import('@novastar/auth')

/** The bands a read returns, and the calls the write path made. */
let storedBands: NamedGradeBand[] = []
let storedRow: Record<string, unknown> | null = null
const created: Array<Record<string, unknown>> = []
const updated: Array<Record<string, unknown>> = []
const deleted: Array<Record<string, unknown>> = []
/** How many times the route read a scale's bands. */
let bandReads = 0

/** A scale as the parent lookup sees it: a tenant, and the school that owns it. */
type ScaleRow = { id: string; tenantId: string; schoolId: string | null }

/**
 * One tenant with two schools, plus one scale belonging to another tenant.
 *
 * `scale-shared` has no school of its own (`schoolId` null), which is what a
 * tenant-wide scale looks like and is why "the caller's school OR shared" is the
 * predicate a band write needs rather than a plain equality on school.
 */
const TENANT_SCALES: ScaleRow[] = [
  { id: 'scale-primary', tenantId: 'tenant-1', schoolId: 'school-1' },
  { id: 'scale-other-school', tenantId: 'tenant-1', schoolId: 'school-2' },
  { id: 'scale-shared', tenantId: 'tenant-1', schoolId: null },
  { id: 'scale-other-tenant', tenantId: 'tenant-2', schoolId: 'school-1' },
]

let visibleScales: ScaleRow[] = []
/** Every where-clause the parent lookup was asked with, in order. */
const scaleLookups: Array<Record<string, unknown>> = []

const gradingLevelFindMany = mock(async () => {
  bandReads += 1
  return storedBands
})
const gradingLevelFindFirst = mock(async () => storedRow)

/**
 * The parent lookup, answered from the clause the route built rather than from
 * the id it asked for: the scale must match by id, by tenant, and by one of the
 * school values the clause allows.
 *
 * Answering from the clause is the point. A route that asked by id alone, or
 * dropped the tenant, or dropped the school clause, gets a different answer here
 * than it deserves — and gets `null` for a foreign scale it should never have
 * been asked about, which is the leak this suite exists to close.
 */
const gradingScaleFindFirst = mock(
  async (args: {
    where: { id: string; tenantId: string; OR: Array<{ schoolId: string | null }> }
  }) => {
    scaleLookups.push(args.where)
    const { id, tenantId, OR } = args.where
    return (
      visibleScales.find(
        (scale) =>
          scale.id === id &&
          scale.tenantId === tenantId &&
          OR.some((clause) => clause.schoolId === scale.schoolId),
      ) ?? null
    )
  },
)

const gradingLevelCreate = mock(async (args: { data: Record<string, unknown> }) => {
  created.push(args.data)
  return args.data
})
const gradingLevelUpdate = mock(async (args: { data: Record<string, unknown> }) => {
  updated.push(args.data)
  return { ...storedRow, ...args.data }
})
const gradingLevelDelete = mock(async (args: { where: Record<string, unknown> }) => {
  deleted.push(args.where)
  return storedRow ?? {}
})

/** A second entity, to prove the check runs only where an entry declares it. */
const feeCategoryCreate = mock(async (args: { data: Record<string, unknown> }) => args.data)

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
// `mock.module` patches the LIVE namespace for the whole process and never reverts, so a
// registration made at module scope is what every file loaded afterwards binds to. All
// four boundaries are put back. `server-only` goes first and alone because the real
// `@/lib/tenant` imports it and the package is not installed here, so nothing else is
// capturable until that specifier resolves.
//
// The remaining snapshots are read HERE, before the first real registration. That is the
// load-bearing part: a `beforeEach` capture would run after these registrations had
// already overwritten the namespace, so it would record this file's own factory and hand
// the double straight back to the next file.
//
// Every factory SPREADS the namespace it replaces and then overrides, making each fake
// both a superset (no caller can fail on a name this file did not list) and a subset
// (`mock.module` merges, so an added key could never be removed by the restore).
const previousNamespaces = new Map<string, Record<string, unknown>>([
  ['@novastar/auth', { ...actualAuth }],
])

mock.module('server-only', () => ({}))

previousNamespaces.set('server-only', { ...(await import('server-only')) })
previousNamespaces.set('@/lib/tenant', { ...(await import('@/lib/tenant')) })
previousNamespaces.set('@/lib/prisma', { ...(await import('@/lib/prisma')) })

const base = (specifier: string): Record<string, unknown> =>
  previousNamespaces.get(specifier) ?? {}

const FAKES = [
  {
    specifier: '@novastar/auth',
    factory: () => ({
      ...base('@novastar/auth'),
      hasPermission: async () => permissionGranted,
    }),
  },
  {
    specifier: '@/lib/tenant',
    factory: () => ({
      ...base('@/lib/tenant'),
      getTenantContext: async () => tenantContext,
      getTenantContextOrNull: async () => tenantContext,
      UnauthorizedError: MockUnauthorizedError,
      ForbiddenError: MockForbiddenError,
      ServerConfigError: MockServerConfigError,
    }),
  },
  {
    specifier: '@/lib/prisma',
    factory: () => ({
      ...base('@/lib/prisma'),
      prisma: {
        gradingLevel: {
          findMany: gradingLevelFindMany,
          findFirst: gradingLevelFindFirst,
          create: gradingLevelCreate,
          update: gradingLevelUpdate,
          delete: gradingLevelDelete,
        },
        gradingScale: { findFirst: gradingScaleFindFirst },
        feeCategory: { create: feeCategoryCreate },
      },
    }),
  },
] as const

// Also registered at load time, so the route imports below resolve these specifiers
// through the doubles and the file is correct in a run that never reaches `beforeEach`.
for (const { specifier, factory } of FAKES) {
  mock.module(specifier, factory)
}

const silencedError = spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => {
  silencedError.mockRestore()
})

const { POST } = await import('@/app/api/config/[entityType]/route')
const { PATCH, DELETE } = await import('@/app/api/config/[entityType]/[id]/route')

beforeEach(() => {
  for (const { specifier, factory } of FAKES) {
    mock.module(specifier, factory)
  }
  storedBands = PRIMARY.map((band) => ({ ...band }))
  storedRow = null
  permissionGranted = true
  created.length = 0
  updated.length = 0
  deleted.length = 0
  bandReads = 0
  visibleScales = TENANT_SCALES.map((scale) => ({ ...scale }))
  scaleLookups.length = 0
  // A test that moves the caller moves it back here, so one case cannot hand the
  // next one a caller with no school.
  tenantContext.tenantId = 'tenant-1'
  tenantContext.schoolId = 'school-1'
})

function request(method: string, body: unknown, path = '/api/config/grading_level') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const post = (body: unknown, entityType = 'grading_level') =>
  POST(request('POST', body), { params: Promise.resolve({ entityType }) })

const patch = (id: string, body: unknown) =>
  PATCH(request('PATCH', body), {
    params: Promise.resolve({ entityType: 'grading_level', id }),
  })

const remove = (id: string) =>
  DELETE(request('DELETE', {}), {
    params: Promise.resolve({ entityType: 'grading_level', id }),
  })

const issuesOf = async (res: Response): Promise<unknown> =>
  ((await res.json()) as { issues?: unknown }).issues

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

describe('findGradeBandDefects - what makes a scale mis-grade a child', () => {
  it('accepts a scale that covers 0-100 exactly once', () => {
    expect(findGradeBandDefects(PRIMARY)).toEqual([])
  })

  it('names the range an admin left uncovered, which is the defect from the review', () => {
    // Band 3 mistyped from 65 to 66: 60-65 now matches nothing.
    const mistyped = PRIMARY.map((band) =>
      band.key === 'level_4' ? { ...band, minScore: 66 } : band,
    )
    expect(findGradeBandDefects(mistyped)).toEqual([
      '60-65% falls between level_3 and level_4 and matches no band',
    ])
  })

  it('names an overlap, because the winning band would be a function of row order', () => {
    const overlapping = PRIMARY.map((band) =>
      band.key === 'level_4' ? { ...band, minScore: 55 } : band,
    )
    const defects = findGradeBandDefects(overlapping)
    expect(defects).toHaveLength(1)
    expect(defects[0]).toContain('both claim')
  })

  it('names a band that runs backwards and one that leaves 0-100 entirely', () => {
    const broken: NamedGradeBand[] = [
      { key: 'backwards', minScore: 90, maxScore: 10 },
      { key: 'past_the_top', minScore: 100, maxScore: 120 },
    ]
    const defects = findGradeBandDefects(broken)
    expect(defects).toHaveLength(2)
    expect(defects[0]).toContain('runs backwards')
    expect(defects[1]).toContain('outside 0-100')
  })

  it('does not treat the edges of 0-100 as defects', () => {
    // A school that reports nothing below 50 has decided something legitimate,
    // and a scale being built one band at a time looks the same. Only a hole in
    // the middle has no honest reading, which is why only that one is fatal.
    expect(findGradeBandDefects([{ key: 'half', minScore: 50, maxScore: 100 }])).toEqual([])
    expect(findGradeBandDefects([{ key: 'one', minScore: 20, maxScore: 39 }])).toEqual([])
    expect(findGradeBandDefects([])).toEqual([])
  })

  it('reports no hole for a range an earlier band already claims', () => {
    // The false defect. `c 30-45` sits inside `a 0-49`, so 46-49 is claimed by `a`
    // and no percentage there is ungraded. Comparing each band against the PREVIOUS
    // row alone compared `b 50-100` against `c`, whose own end (45) is not the
    // scale's, and named 46-49% as matching no band.
    const nested: NamedGradeBand[] = [
      { key: 'a', minScore: 0, maxScore: 49 },
      { key: 'c', minScore: 30, maxScore: 45 },
      { key: 'b', minScore: 50, maxScore: 100 },
    ]
    // The overlap is a real defect and is still reported — 30-45 belongs to two
    // bands, so `resolveGradeBand` refuses it rather than picking by row order.
    expect(findGradeBandDefects(nested)).toEqual([
      'a (0-49) and c (30-45) both claim 30-45',
    ])
    expect(findGradeBandDefects(nested).some((problem) => problem.includes('matches no band'))).toBe(
      false,
    )
    // 46 is claimed by `a`, so the range the old algorithm named was not a hole.
    expect(resolveGradeBand(46, nested)?.key).toBe('a')
    expect(resolveGradeBand(30, nested)).toBeNull()
  })

  it('names the true unclaimed range, not one extended by a nested band', () => {
    // With `b` moved to 55-100 the scale has a real gap as well, and it is
    // 50-54. The old comparison measured it from `c`'s end instead and reported
    // "46-54%", which named two percentages that `a` claims as ungraded and so
    // pointed a head teacher at the wrong boundary.
    const nested: NamedGradeBand[] = [
      { key: 'a', minScore: 0, maxScore: 49 },
      { key: 'c', minScore: 30, maxScore: 45 },
      { key: 'b', minScore: 55, maxScore: 100 },
    ]
    expect(findGradeBandDefects(nested)).toContain(
      '50-54% falls between c and b and matches no band',
    )
    expect(findGradeBandDefects(nested).join('; ')).not.toContain('46-54%')
    expect(resolveGradeBand(46, nested)?.key).toBe('a')
    expect(resolveGradeBand(52, nested)).toBeNull()
    // 50-54 is exactly the set of percentages nothing claims, boundaries included.
    const unclaimed = [50, 51, 52, 53, 54].every((p) => resolveGradeBand(p, nested) === null)
    expect(unclaimed).toBe(true)
    expect(resolveGradeBand(49, nested)?.key).toBe('a')
    expect(resolveGradeBand(55, nested)?.key).toBe('b')
  })

  it('still finds an ordinary gap between two bands', () => {
    // A band reaching further than the row before it is necessarily an overlap —
    // there is no way to nest two bands without doubling up a percentage — so the
    // plain two-band gap is the case that must keep working unchanged. Here the
    // coverage above the gap ends at `b`'s own 55, not at `a`'s 49.
    const withHole: NamedGradeBand[] = [
      { key: 'a', minScore: 0, maxScore: 49 },
      { key: 'b', minScore: 40, maxScore: 55 },
      { key: 'd', minScore: 60, maxScore: 100 },
    ]
    expect(findGradeBandDefects(withHole)).toContain(
      '56-59% falls between b and d and matches no band',
    )
    expect(resolveGradeBand(57, withHole)).toBeNull()
    // 20 is claimed by `a` alone, even though `b` starts at 40; 49 is claimed by
    // both, so it is the overlap defect rather than a band.
    expect(resolveGradeBand(20, withHole)?.key).toBe('a')
    expect(resolveGradeBand(49, withHole)).toBeNull()
  })
})

describe('findGradeBandCoverageGaps and the strict seed assertion', () => {
  it('reports the uncovered edges of a scale that stops short', () => {
    expect(findGradeBandCoverageGaps(PRIMARY)).toEqual([])
    expect(findGradeBandCoverageGaps([{ key: 'upper', minScore: 50, maxScore: 100 }])).toEqual([
      'no band covers 0-49%',
    ])
    expect(findGradeBandCoverageGaps([{ key: 'lower', minScore: 0, maxScore: 69 }])).toEqual([
      'no band covers 70-100%',
    ])
  })

  it('is the one implementation the seed and the write path share', () => {
    expect(() => assertBandsCoverZeroToHundred('Ghana Primary', PRIMARY)).not.toThrow()
    // A scale that is merely unfinished is refused by the strict form only.
    expect(() =>
      assertBandsCoverZeroToHundred('Half a scale', [{ key: 'half', minScore: 50, maxScore: 100 }]),
    ).toThrow(/does not cover 0-100 exactly once: no band covers 0-49%/)
    expect(() =>
      assertBandsCoverZeroToHundred('Mistyped', [
        ...PRIMARY.map((band) => (band.key === 'level_4' ? { ...band, minScore: 66 } : band)),
      ]),
    ).toThrow(/60-65% falls between level_3 and level_4/)
  })
})

// ---------------------------------------------------------------------------
// The cross-row write rule
// ---------------------------------------------------------------------------

describe('gradeBandWriteProblems - one row judged against its whole scale', () => {
  it('refuses a write that would make two bands claim one percentage', () => {
    // The defect a one-row write CAN decide: widening level_4 to 55-69 makes
    // 55-59 belong to level_4 and level_3 at once, and the winner would be a
    // function of row order rather than of the score.
    const problems = gradeBandWriteProblems({
      write: { key: 'level_4', minScore: 55, maxScore: 69 },
      stored: PRIMARY,
      editedId: 'b4',
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('both claim 55-59')
  })

  it('accepts a write that leaves the scale able to grade', () => {
    expect(
      gradeBandWriteProblems({
        write: { key: 'level_4', minScore: 60, maxScore: 69 },
        stored: PRIMARY,
        editedId: 'b4',
      }),
    ).toEqual([])
  })

  it('lets a school build a scale one band at a time', () => {
    // A single band is never exhaustive on its own, so refusing it would make the
    // scale unbuildable through an endpoint that writes one row per request.
    expect(
      gradeBandWriteProblems({
        write: { key: 'level_6', minScore: 85, maxScore: 100 },
        stored: [],
        editedId: null,
      }),
    ).toEqual([])
  })

  it('refuses a create that would overlap a band already on the scale', () => {
    const problems = gradeBandWriteProblems({
      write: { key: 'extra', minScore: 55, maxScore: 95 },
      stored: PRIMARY,
      editedId: null,
    })
    // Every neighbour the new range collides with is named, so the admin is not
    // left guessing which band has to move.
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('level_3 (50-59) and extra (55-95) both claim 55-59')
    expect(problems[1]).toContain('extra (55-95) and level_4 (60-69) both claim 60-69')
  })

  it('allows the first half of a two-row retune, which a hole rule would deadlock', () => {
    // level_4 60-69 -> 65-69 leaves 60-64 uncovered. That state must be
    // reachable, or no boundary could ever move: the caller widens level_3 to
    // 50-64 in the next request and the scale tiles again. What this state must
    // never do is mis-grade, which is `resolveGradeBand`'s job — asserted in the
    // last suite of this file.
    expect(
      gradeBandWriteProblems({
        write: { key: 'level_4', minScore: 65, maxScore: 69 },
        stored: PRIMARY,
        editedId: 'b4',
      }),
    ).toEqual([])
    // And the closing step is accepted too.
    expect(
      gradeBandWriteProblems({
        write: { key: 'level_3', minScore: 50, maxScore: 64 },
        stored: PRIMARY.map((band) =>
          band.key === 'level_4' ? { ...band, minScore: 65 } : band,
        ),
        editedId: 'b3',
      }),
    ).toEqual([])
  })

  it('allows deleting a middle band, because deletion is a step of a restructure', () => {
    // The hole it leaves is reported by `resolveGradeBand` and by
    // `findGradeBandDefects`; refusing the delete would make removing a band
    // impossible, since widening a neighbour first is itself blocked as an overlap.
    expect(
      gradeBandWriteProblems({ write: null, stored: PRIMARY, editedId: 'b4' }),
    ).toEqual([])
  })
})

describe('gradingScaleBandWriteRule - the rule the registry dispatches to', () => {
  const reader = async (gradingScaleId: string) =>
    gradingScaleId === 'scale-primary' ? PRIMARY : []

  it('judges a create against the scale it names', async () => {
    expect(
      await gradingScaleBandWriteRule({
        operation: 'create',
        write: { gradingScaleId: 'scale-primary', key: 'extra', minScore: 55, maxScore: 95 },
        existing: null,
        readScaleBands: reader,
      }),
    ).toHaveLength(2)
  })

  it('judges a partial patch against the scale the row already belongs to', async () => {
    // The patch moves one boundary and names no scale, which is the normal way a
    // head teacher retunes a band. Judged against the stored row merged with it.
    expect(
      await gradingScaleBandWriteRule({
        operation: 'update',
        write: { minScore: 55 },
        existing: { id: 'b4', gradingScaleId: 'scale-primary', key: 'level_4', minScore: 60, maxScore: 69 },
        readScaleBands: reader,
      }),
    ).toEqual(['level_3 (50-59) and level_4 (55-69) both claim 55-59'])
  })

  it('judges a band moved to another scale against its destination', async () => {
    expect(
      await gradingScaleBandWriteRule({
        operation: 'update',
        write: { gradingScaleId: 'scale-primary' },
        existing: { id: 'b9', gradingScaleId: 'scale-empty', key: 'stray', minScore: 55, maxScore: 95 },
        readScaleBands: reader,
      }),
    ).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// The write path itself
// ---------------------------------------------------------------------------

describe('POST /api/config/grading_level - the scale is checked before the row is written', () => {
  it('refuses a band that would make two bands claim one percentage', async () => {
    storedRow = null
    const res = await post({
      gradingScaleId: 'scale-primary',
      key: 'level_4b',
      label: 'Level 4',
      minScore: 55,
      maxScore: 69,
      color: '#65a30d',
      order: 14,
    })

    expect(res.status).toBe(400)
    // Every colliding neighbour is named in the 400, not just the first.
    expect(await issuesOf(res)).toEqual([
      'level_3 (50-59) and level_4b (55-69) both claim 55-59',
      'level_4b (55-69) and level_4 (60-69) both claim 60-69',
    ])
    expect(created).toEqual([])
  })

  it('writes a band that fits the scale', async () => {
    storedBands = []
    const res = await post({
      gradingScaleId: 'scale-primary',
      key: 'level_6',
      label: 'Level 6',
      minScore: 85,
      maxScore: 100,
      color: '#047857',
      order: 6,
    })

    expect(res.status).toBe(201)
    expect(created).toHaveLength(1)
  })

  it('answers the row schema first when the band is out of range at all', async () => {
    const res = await post({
      gradingScaleId: 'scale-primary',
      key: 'level_6',
      label: 'Level 6',
      minScore: 101,
      maxScore: 100,
      color: '#047857',
      order: 6,
    })

    // WHICH schema answered is the claim, not the 400. Both refusals are a 400:
    // the row schema names the offending FIELD, and the cross-row rule names the
    // two BANDS that collide. A `400` and no write is equally true of a collision,
    // so it establishes nothing on its own.
    const body = (await res.json()) as { error: string; issues: unknown }

    expect(res.status).toBe(400)
    expect(body.error).toBe('Validation failed')
    // A field-keyed issue map with a `_errors` list under `minScore` is Zod's
    // `format()`. The cross-row rule answers with a flat array of sentences, which
    // has no `minScore` key at all.
    expect(Array.isArray(body.issues)).toBe(false)
    const fieldIssues = body.issues as Record<string, { _errors?: string[] }>
    expect(fieldIssues.minScore._errors?.[0]).toContain('<=100')
    expect(fieldIssues.minScore._errors?.[1]).toBe(
      'minScore must be less than or equal to maxScore',
    )
    // And the cross-row rule demonstrably never ran: it cannot name two colliding
    // bands without first reading the scale's, so a read count of zero is the
    // direct evidence that the row schema short-circuited ahead of it.
    expect(bandReads).toBe(0)
    expect(created).toEqual([])
  })

  it('does not run the check for an entity that declares none', async () => {
    const res = await post(
      { name: 'Tuition', code: 'TUITION', description: 'Termly fees' },
      'fee_category',
    )

    // fee_category declares no cross-row rule, so the route writes it without ever
    // reading a sibling row: the check is not a global tax on every config write,
    // it runs where an entry declares it.
    expect(res.status).toBe(201)
    expect(bandReads).toBe(0)
  })
})

describe('PATCH /api/config/grading_level/[id] - retuning a boundary', () => {
  const storedBand = {
    id: 'b4',
    tenantId: 'tenant-1',
    gradingScaleId: 'scale-primary',
    key: 'level_4',
    label: 'Level 4 — Adequate',
    minScore: 60,
    maxScore: 69,
    color: '#65a30d',
    order: 4,
  }

  it('refuses a boundary that would make two bands claim one percentage', async () => {
    storedRow = { ...storedBand }

    const res = await patch('b4', { minScore: 55, maxScore: 69 })

    expect(res.status).toBe(400)
    expect(await issuesOf(res)).toEqual([
      'level_3 (50-59) and level_4 (55-69) both claim 55-59',
    ])
    expect(updated).toEqual([])
  })

  it('still refuses an inverted band from the row schema itself', async () => {
    storedRow = { ...storedBand }

    const res = await patch('b4', { minScore: 90, maxScore: 10 })

    expect(res.status).toBe(400)
    expect(updated).toEqual([])
  })

  it('accepts the first half of a retune, and the range it leaves cannot mis-grade', async () => {
    storedRow = { ...storedBand }

    // This is the same single-row write as mistyping 65 to 66, and the route
    // cannot tell them apart — see `findGradeBandWriteConflicts`. What must hold is
    // that the resulting scale cannot silently mis-grade a child: 60-64 is
    // level_4, 65-69 is now claimed by nobody and is reported ungraded rather than
    // handed to level_3.
    const res = await patch('b4', { minScore: 60, maxScore: 64 })

    expect(res.status).toBe(200)
    expect(updated).toHaveLength(1)
    // The write carried BOTH boundaries the caller named. `minScore` is not on the
    // route's immutable-field strip, so it must reach the database: adding it to
    // that strip would drop it here, leave the row's lower boundary at whatever it
    // already was, and the assertions below would all still hold — which is
    // precisely how the reconstructed-array version of this test stayed green
    // against that mutation. Asserted on the write because the write is the claim.
    expect(updated[0]).toEqual({ minScore: 60, maxScore: 64 })

    // And what the route PERSISTED is read back, rather than the scale being
    // rebuilt from `PRIMARY` with the expected value pasted in.
    const persisted = (await res.json()) as NamedGradeBand
    expect(persisted.minScore).toBe(60)
    expect(persisted.maxScore).toBe(64)

    const afterWrite: NamedGradeBand[] = PRIMARY.map((band) =>
      band.key === persisted.key ? persisted : band,
    )
    expect(findGradeBandDefects(afterWrite)).toEqual([
      '65-69% falls between level_4 and level_5 and matches no band',
    ])
    expect(keyFor(afterWrite, 62)).toBe('level_4')
    expect(keyFor(afterWrite, 67)).toBeNull()
  })
})

describe('DELETE /api/config/grading_level/[id] - removing a middle band', () => {
  it('removes it, and the range it leaves cannot mis-grade', async () => {
    storedRow = {
      id: 'b4',
      tenantId: 'tenant-1',
      gradingScaleId: 'scale-primary',
      key: 'level_4',
      label: 'Level 4 — Adequate',
      minScore: 60,
      maxScore: 69,
      color: '#65a30d',
      order: 4,
    }

    const res = await remove('b4')

    // Refusing this would make a band impossible to remove: widening a neighbour
    // first is itself an overlap, so no order of two single-row writes gets there.
    expect(res.status).toBe(200)
    expect(deleted).toHaveLength(1)

    const afterDelete = PRIMARY.filter((band) => band.id !== 'b4')
    expect(findGradeBandDefects(afterDelete)).toEqual([
      '60-69% falls between level_3 and level_5 and matches no band',
    ])
    expect(keyFor(afterDelete, 65)).toBeNull()
  })

  it('removes a band that leaves no hole', async () => {
    storedBands = PRIMARY.filter((band) => band.key !== 'level_1')
    storedRow = {
      id: 'b1',
      tenantId: 'tenant-1',
      gradingScaleId: 'scale-primary',
      key: 'level_1',
      label: 'Level 1',
      minScore: 0,
      maxScore: 39,
      color: '#dc2626',
      order: 1,
    }

    const res = await remove('b1')

    expect(res.status).toBe(200)
    expect(deleted).toHaveLength(1)
  })
})

/**
 * The row a band hangs from, which is not the row being written.
 *
 * A band row has no `schoolId` of its own, so the school that grades a child
 * against it is the school of its SCALE. Proving the row is the caller's
 * therefore proves nothing about the school whose grading the row changes — and
 * the generic config route used to stop there.
 *
 * THE EXPLOIT, in a tenant with two schools: a headmaster of School A holding
 * `config:write` posts a band whose `gradingScaleId` is School B's scale. The
 * write passes every check that existed, the row persists with the caller's own
 * `tenantId`, and from then on B's report and gradebook grade children against a
 * band A wrote. B cannot see it — the list endpoint filters on `tenantId`, so B
 * does not see A's rows — and B's own PATCH/DELETE of it 404s, because those
 * require `tenantId = B`. A has no endpoint that removes it. There was no way
 * out of this through the API at all.
 */
describe('a band can only be written against a scale the caller owns', () => {
  /** A band that fits the hole between 40-49 and 50-59 of the seeded scale. */
  const bandForScale = (gradingScaleId: string, key = 'level_extra') => ({
    gradingScaleId,
    key,
    label: 'Extra',
    minScore: 40,
    maxScore: 49,
    color: '#047857',
    order: 42,
  })

  const schoolBScale = 'scale-other-school'

  it('refuses to attach a band to another school\'s scale, and writes nothing', async () => {
    const res = await post(bandForScale(schoolBScale))

    expect(res.status).toBe(404)
    expect(created).toEqual([])
  })

  it('asks the database whether the scale is the caller\'s, under a scoped clause', async () => {
    await post(bandForScale(schoolBScale))

    // The predicate, asserted on the argument the mocked delegate received rather
    // than on the answer: a 404 alone would be equally consistent with a route
    // that scoped, one that refused everything, and one that never looked.
    expect(scaleLookups).toHaveLength(1)
    expect(scaleLookups[0]).toEqual({
      id: schoolBScale,
      tenantId: 'tenant-1',
      OR: [{ schoolId: 'school-1' }, { schoolId: null }],
    })
  })

  it('answers a foreign scale and a missing one identically, so neither is confirmed', async () => {
    const foreign = await post(bandForScale(schoolBScale))
    const missing = await post(bandForScale('scale-does-not-exist'))

    // Telling them apart would confirm that another school's scale is real, and
    // that is the only thing a caller probing for one wants to learn.
    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual(await foreign.json())
    expect(created).toEqual([])
  })

  it('refuses a scale from another tenant, which the tenant clause is there for', async () => {
    const res = await post(bandForScale('scale-other-tenant'))

    expect(res.status).toBe(404)
    expect(scaleLookups[0]).toMatchObject({ tenantId: 'tenant-1' })
    expect(created).toEqual([])
  })

  it('never reads another school\'s bands, so none of them can reach the 400', async () => {
    // The seeded bands belong to `scale-primary`; a foreign scale in this fake
    // read would return them anyway, so the assertion is on the read not
    // happening at all. A 400 body naming B's band keys is a disclosure of B's
    // grading configuration, whatever status it arrives with.
    const res = await post({ ...bandForScale(schoolBScale), minScore: 60, maxScore: 69 })

    expect(res.status).toBe(404)
    expect(bandReads).toBe(0)
    expect(JSON.stringify(await res.json())).not.toMatch(/level_3|level_4|level_5/)
  })

  it('accepts a tenant-wide scale, which every school in the tenant shares', async () => {
    storedBands = []
    const res = await post(bandForScale('scale-shared'))

    // `schoolId: null` is not "nobody's": it is a scale the tenant owns outright,
    // and refusing it would refuse every band a school writes against the shared
    // scale the seed creates.
    expect(res.status).toBe(201)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ gradingScaleId: 'scale-shared', tenantId: 'tenant-1' })
  })

  it('gives a caller with no school only the tenant-wide scales', async () => {
    tenantContext.schoolId = null
    storedBands = []

    const shared = await post(bandForScale('scale-shared', 'shared_band'))
    expect(shared.status).toBe(201)

    const ownSchool = await post(bandForScale('scale-primary', 'school_a_band'))
    // The predicate still carries both school values, one of which is null, so a
    // caller with no school reaches a scale belonging to School A by neither.
    expect(ownSchool.status).toBe(404)
    expect(scaleLookups[1]).toEqual({
      id: 'scale-primary',
      tenantId: 'tenant-1',
      OR: [{ schoolId: null }, { schoolId: null }],
    })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ key: 'shared_band' })
  })

  it('asks the parent question once per write, and judges the band under that answer', async () => {
    storedBands = []
    const res = await post(bandForScale('scale-primary'))

    expect(res.status).toBe(201)
    // Two reads would mean the route proved the parent and then read the sibling
    // bands on a different answer to the same question.
    expect(scaleLookups).toHaveLength(1)
    expect(bandReads).toBe(1)
  })

  it('still judges the band against the bands of a scale the caller does own', async () => {
    // The ownership check must not have replaced the conflict check: 55-69 makes
    // 55-59 belong to two bands at once, on the caller's own scale.
    const res = await post({
      gradingScaleId: 'scale-primary',
      key: 'level_4b',
      label: 'Level 4',
      minScore: 55,
      maxScore: 69,
      color: '#65a30d',
      order: 14,
    })

    expect(res.status).toBe(400)
    expect(await issuesOf(res)).toEqual([
      'level_3 (50-59) and level_4b (55-69) both claim 55-59',
      'level_4b (55-69) and level_4 (60-69) both claim 60-69',
    ])
    expect(created).toEqual([])
  })

  describe('an edit cannot move a band onto a foreign scale', () => {
    const storedBand = {
      id: 'b4',
      tenantId: 'tenant-1',
      gradingScaleId: 'scale-primary',
      key: 'level_4',
      label: 'Level 4 — Adequate',
      minScore: 60,
      maxScore: 69,
      color: '#65a30d',
      order: 4,
    }

    it('refuses the move and leaves the row alone', async () => {
      storedRow = { ...storedBand }

      const res = await patch('b4', { gradingScaleId: schoolBScale })

      // The update schema keeps `gradingScaleId` because the one client of this
      // endpoint submits the whole field set on every edit, so the value that
      // arrives here is usually the row's own scale. That is why the route has
      // to resolve whatever value it is given and prove it, rather than assume
      // it is a no-op.
      expect(res.status).toBe(404)
      expect(updated).toEqual([])
      expect(scaleLookups[0]).toEqual({
        id: schoolBScale,
        tenantId: 'tenant-1',
        OR: [{ schoolId: 'school-1' }, { schoolId: null }],
      })
    })

    it('refuses the move even when the band also arrives valid', async () => {
      storedRow = { ...storedBand }
      storedBands = []

      const res = await patch('b4', { gradingScaleId: schoolBScale, minScore: 60, maxScore: 69 })

      // No band to conflict with, so every range check passes. Ownership is the
      // only thing standing between this write and another school's gradebook.
      expect(res.status).toBe(404)
      expect(updated).toEqual([])
    })

    it('accepts the edit the settings form actually sends', async () => {
      storedRow = { ...storedBand }

      // The generic settings form is built from the entity registry, which lists
      // `gradingScaleId` as a required select, so every edit a school admin makes
      // in the UI carries the band's own scale whether or not they touched it.
      const res = await patch('b4', { gradingScaleId: 'scale-primary', minScore: 60, maxScore: 64 })

      expect(res.status).toBe(200)
      expect(updated).toHaveLength(1)
      expect(scaleLookups[0]).toMatchObject({ id: 'scale-primary', tenantId: 'tenant-1' })
    })

    it('still resolves the stored scale when the patch names none', async () => {
      storedRow = { ...storedBand, gradingScaleId: schoolBScale }

      // A patch that never mentions the scale is not exempt: the row it edits
      // already hangs from a scale that is not the caller's, and editing it
      // would keep a foreign band in place rather than repair anything.
      const res = await patch('b4', { label: 'Level 4 — Adequate (retitled)' })

      expect(res.status).toBe(404)
      expect(scaleLookups[0]).toMatchObject({ id: schoolBScale })
      expect(updated).toEqual([])
    })
  })

  it('lets the owner delete a band whose scale turned out to be somebody else\'s', async () => {
    // The row is the caller's, so removing it is the safe direction — and refusing
    // would strand exactly the rows this hole created, with no other way out.
    storedRow = {
      id: 'b4',
      tenantId: 'tenant-1',
      gradingScaleId: schoolBScale,
      key: 'level_4',
      label: 'Level 4',
      minScore: 60,
      maxScore: 69,
      color: '#65a30d',
      order: 4,
    }

    const res = await remove('b4')

    expect(res.status).toBe(200)
    expect(deleted).toHaveLength(1)
  })
});

describe('the invariant travels with the entity, and the route never names it', () => {
  it('is declared by the grading_level registry entry', () => {
    expect(ENTITY_CONFIG_MAP.grading_level?.writeValidation?.kind).toBe(
      'grading_scale_bands',
    )
  })

  it('is dispatched by kind in both config routes, before the write', () => {
    const routeSrc = readFileSync(
      join(import.meta.dir, '..', 'app', 'api', 'config', '[entityType]', 'route.ts'),
      'utf-8',
    )
    const idSrc = readFileSync(
      join(import.meta.dir, '..', 'app', 'api', 'config', '[entityType]', '[id]', 'route.ts'),
      'utf-8',
    )
    for (const src of [routeSrc, idSrc]) {
      // No entity special-case: the route reads the kind the registry declares and
      // never names the entity it is protecting. Quoted, because the GET comment
      // above legitimately lists the tenant-only entity types.
      expect(src).not.toMatch(/['"`]grading_level/)
      expect(src).toContain('crossRowWriteProblems')
      expect(src).toContain('entityConfig.writeValidation?.kind')
      // Reading the rule is what registers it; a rule that is defined and never
      // dispatched validates nothing.
      expect(src).toContain('CROSS_ROW_WRITE_RULES[kind]')
      // Fail closed on a wiring fault rather than writing an unvalidated row.
      expect(src).toContain('No cross-row write rule is registered for')
      // The parent check rides the same kind: a cross-row entity declares which
      // row it hangs from, and the route proves that row before it writes.
      expect(src).toContain('PARENT_SCOPE_CHECKS[kind]')
      expect(src).toContain('parentWriteRefusal')
    }
    // PATCH and DELETE are both writes and both go through the check.
    expect(idSrc.match(/crossRowWriteProblems\(/g)?.length).toBe(3)
    // And on POST the check runs before the create.
    expect(routeSrc.indexOf('crossRowWriteProblems(')).toBeLessThan(
      routeSrc.indexOf('model.create('),
    )
    expect(idSrc.indexOf("operation: 'update'")).toBeLessThan(
      idSrc.indexOf('model.update('),
    )
    expect(idSrc.indexOf("operation: 'delete'")).toBeLessThan(
      idSrc.indexOf('model.delete('),
    )
    // The parent is proved before the write, not after it and not only in the
    // conflict check: an ordering that ran it second would already have written
    // a row this suite asserts was never written.
    for (const [src, write] of [
      [routeSrc, 'model.create('],
      [idSrc, 'model.update('],
    ] as const) {
      expect(src.indexOf('parentWriteRefusal(')).toBeLessThan(src.indexOf(write))
    }
    // DELETE is the one write that does not prove the parent: the row it removes
    // is already the caller's, and refusing it for a foreign scale would strand
    // the very rows this check exists to prevent. Two call sites per route —
    // the definition, and the one write that attaches — is what says so.
    expect(idSrc.match(/parentWriteRefusal\(/g)?.length).toBe(2)
    expect(routeSrc.match(/parentWriteRefusal\(/g)?.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Resolution: never a confident wrong label
// ---------------------------------------------------------------------------

describe('resolveGradeBand - a malformed scale cannot silently mis-grade a child', () => {
  const mistyped = PRIMARY.map((band) =>
    band.key === 'level_4' ? { ...band, minScore: 66 } : band,
  )

  it('grades every percentage of a healthy scale, boundaries included', () => {
    expect(keyFor(PRIMARY, 85)).toBe('level_6')
    expect(keyFor(PRIMARY, 84)).toBe('level_5')
    expect(keyFor(PRIMARY, 65)).toBe('level_4')
    expect(keyFor(PRIMARY, 60)).toBe('level_4')
    expect(keyFor(PRIMARY, 59)).toBe('level_3')
    expect(keyFor(PRIMARY, 0)).toBe('level_1')
  })

  it('refuses a percentage in the hole instead of handing it the band below', () => {
    // THE DEFECT. Before: 65 matched nothing and fell through to "the nearest band
    // beneath", so a child who scored exactly 65 was reported as level_3.
    expect(keyFor(mistyped, 65)).toBeNull()
    for (let percentage = 60; percentage <= 65; percentage += 1) {
      expect(keyFor(mistyped, percentage)).toBeNull()
    }
    // The rest of the scale is untouched: the hole does not poison it.
    expect(keyFor(mistyped, 59)).toBe('level_3')
    expect(keyFor(mistyped, 66)).toBe('level_4')
  })

  it('refuses a percentage two bands both claim', () => {
    const overlapping = PRIMARY.map((band) =>
      band.key === 'level_4' ? { ...band, minScore: 55 } : band,
    )
    // 55-59 is inside level_4 as well as level_3. Answering either would make the
    // label a function of row order.
    for (let percentage = 55; percentage <= 59; percentage += 1) {
      expect(keyFor(overlapping, percentage)).toBeNull()
    }
    expect(keyFor(overlapping, 54)).toBe('level_3')
    expect(keyFor(overlapping, 60)).toBe('level_4')
  })

  it('refuses a percentage above 100, whatever the scale spans, instead of the top band', () => {
    // THE DEFECT. Before: 85 matched nothing on this scale and fell through to
    // "the band with the highest minScore", so a child scoring 85% was recorded
    // as 'high'. On a full 0-100 scale the same escape hatch turned 150 — which
    // on a 100-mark assessment is almost always a 15 with a stray zero — into
    // level_6, 'Excellent'.
    const narrow: TestBand[] = [
      band('low', 0, 49, 'Low'),
      band('high', 50, 69, 'High'),
    ]
    expect(keyFor(narrow, 69)).toBe('high')
    expect(keyFor(narrow, 70)).toBeNull()
    expect(keyFor(narrow, 85)).toBeNull()
    expect(keyFor(narrow, 100)).toBeNull()
    // Every value the review listed yields no band.
    for (const percentage of [100.5, 120, 150, 300, 850, 999.99, 1000]) {
      expect(keyFor(narrow, percentage)).toBeNull()
      expect(keyFor(PRIMARY, percentage)).toBeNull()
    }
    expect(keyFor(PRIMARY, -1)).toBeNull()
    // The scale's own extent is not the rule, so a school reporting nothing above
    // 69 is owed nothing at 85 — and is not penalised anywhere else: all of
    // 0-69 still grades.
    for (let percentage = 0; percentage <= 69; percentage += 1) {
      expect(keyFor(narrow, percentage)).not.toBeNull()
    }
  })

  it('leaves a score below the whole scale ungraded, because nothing lies beneath it', () => {
    const narrow: TestBand[] = [
      band('low', 10, 49, 'Low'),
      band('high', 50, 69, 'High'),
    ]
    // 5 is under the scale floor: calling it "Low" would be a fabrication.
    expect(keyFor(narrow, 5)).toBeNull()
    expect(keyFor(narrow, -20)).toBeNull()
    expect(keyFor(narrow, 10)).toBe('low')
  })

  it('reports why a band was withheld rather than rendering nothing', () => {
    const summary = computeAcademicSummary(
      [
        {
          subjectId: 'maths',
          percentage: 65,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
      ],
      mistyped,
    )
    expect(summary.weightedPercentage).toBe(65)
    // The mark is still reported; the band is withheld and the reason travels with
    // it, so a missing badge is read as a misconfigured scale.
    expect(summary.subjects[0]?.band).toBeNull()
    expect(summary.subjects[0]?.bandProblem).toContain(
      '60-65% falls between level_3 and level_4',
    )
  })

  it('states no problem when the scale is healthy or simply absent', () => {
    const healthy = computeAcademicSummary(
      [
        {
          subjectId: 'maths',
          percentage: 65,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
      ],
      PRIMARY,
    )
    expect(healthy.subjects[0]?.band?.key).toBe('level_4')
    expect(healthy.subjects[0]?.bandProblem).toBeNull()

    const noScale = computeAcademicSummary(
      [
        {
          subjectId: 'maths',
          percentage: 65,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
      ],
      [],
    )
    expect(noScale.subjects[0]?.band).toBeNull()
    expect(noScale.subjects[0]?.bandProblem).toBeNull()
  })

  it('states no problem for a subject the broken range cannot touch', () => {
    // The scale still carries the 60-65% hole, so its defects are non-empty — but
    // this subject graded cleanly at 75%, inside level_5. Reporting a fault here
    // would set "Scale error" beside a percentage that resolved perfectly, and a
    // report that contradicts itself is worse than one that is merely incomplete.
    const graded = computeAcademicSummary(
      [
        {
          subjectId: 'maths',
          percentage: 75,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
      ],
      mistyped,
    )
    expect(graded.subjects[0]?.band?.key).toBe('level_5')
    expect(graded.subjects[0]?.bandProblem).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The report's own account of a band it could not show
// ---------------------------------------------------------------------------

/**
 * `band === null` was one answer to six questions, and the report card drew every
 * one of them as a bare "-". These cases fix what each of those six now says, with
 * the percentages a child actually earns.
 *
 * The verified failure is the empty scale: a school restructures its scale through
 * `/api/config/grading_level` — documented as legitimate — and deletes all but the
 * top band. `gradeBandWriteProblems` accepts a delete that leaves fewer than two
 * bands, so nothing refuses it, and `findGradeBandDefects` returns `[]` because it
 * deliberately does not treat the edges of 0-100 as defects. Maths and english at
 * 68% came back `{ percentage: 68, band: null, bandProblem: null }` beside a
 * science band that graded, and the page printed a blank badge.
 */
describe('computeAcademicSummary - bandStatus says which of the six it is', () => {
  /** The Ghana Primary scale with `level_4` mistyped from 60 to 66: 60-65% claims no band. */
  const mistyped: TestBand[] = PRIMARY.map((b) =>
    b.key === 'level_4' ? { ...b, minScore: 66 } : b,
  )

  /** The one subject of a one-subject summary, as the report card reads it. */
  const subjectAt = (percentage: number, bands: readonly GradeBand[]) =>
    computeAcademicSummary(
      [
        {
          subjectId: 'maths',
          percentage,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
      ],
      bands,
    ).subjects[0]

  it('names every state a healthy scale can produce, and `ok` is the only one with a band', () => {
    for (let percentage = 0; percentage <= 100; percentage += 1) {
      const subject = subjectAt(percentage, PRIMARY)
      expect(subject?.bandStatus).toBe('ok')
      expect(subject?.band).not.toBeNull()
      expect(subject?.bandProblem).toBeNull()
    }
    expect(subjectAt(65, PRIMARY)?.band?.key).toBe('level_4')
  })

  it('reports `no-scale` when the school has no scale, and claims no fault', () => {
    const subject = subjectAt(65, [])
    expect(subject?.bandStatus).toBe('no-scale')
    expect(subject?.band).toBeNull()
    // "the scale has no bands" would be a statement about a scale that need not
    // exist, so nothing is claimed; `no-scale` is the whole report.
    expect(subject?.bandProblem).toBeNull()
    expect(subject?.percentage).toBe(65)
  })

  it('reports `no-bands` when every band on the scale cannot claim a percentage', () => {
    // `gradeBandWriteProblems` refuses both of these rows, so they can only reach
    // here from an older database or a direct write. They are still a scale.
    const unusable: TestBand[] = [
      band('backwards', 90, 10, 'Backwards'),
      band('past_the_top', 150, 200, 'Past the top'),
    ]
    const subject = subjectAt(65, unusable)
    expect(subject?.bandStatus).toBe('no-bands')
    expect(subject?.band).toBeNull()
    expect(subject?.bandProblem).toContain('runs backwards')
  })

  it('reports `below-scale` with the range, for a child under the scale\'s floor', () => {
    // A school that reports nothing below 50 has decided that; the child at 45 is
    // still owed the truth about why they have no band.
    const upperHalf: TestBand[] = [band('level_4', 50, 100, 'Level 4')]
    const subject = subjectAt(45, upperHalf)
    expect(subject?.bandStatus).toBe('below-scale')
    expect(subject?.band).toBeNull()
    expect(subject?.bandProblem).toBe('no band covers 0-49%')
    expect(subjectAt(50, upperHalf)?.bandStatus).toBe('ok')
  })

  it('reports `above-scale` with the range, for a child over the scale\'s ceiling', () => {
    const lowerHalf: TestBand[] = [band('level_1', 0, 69, 'Level 1')]
    const subject = subjectAt(85, lowerHalf)
    expect(subject?.bandStatus).toBe('above-scale')
    expect(subject?.band).toBeNull()
    expect(subject?.bandProblem).toBe('no band covers 70-100%')
    // Not the top band, and not a hole either: it is above the whole scale.
    expect(resolveGradeBand(85, lowerHalf)).toBeNull()
  })

  it('reports `hole` with the exact range, and `ambiguous` with both bands', () => {
    const holed = subjectAt(62, mistyped)
    expect(holed?.bandStatus).toBe('hole')
    expect(holed?.band).toBeNull()
    expect(holed?.bandProblem).toBe('60-65% falls between level_3 and level_4 and matches no band')
    // Just outside the hole grades, so the hole is a range and not a subject.
    expect(subjectAt(59, mistyped)?.bandStatus).toBe('ok')
    expect(subjectAt(66, mistyped)?.bandStatus).toBe('ok')

    // `level_4` moved to 55-69, so 55-59 belongs to `level_3` and `level_4` at once.
    const overlapping = PRIMARY.map((b) => (b.key === 'level_4' ? { ...b, minScore: 55 } : b))
    const ambiguous = subjectAt(57, overlapping)
    expect(ambiguous?.bandStatus).toBe('ambiguous')
    expect(ambiguous?.band).toBeNull()
    expect(ambiguous?.bandProblem).toContain('both claim')
    // 60 is outside the overlap and grades normally on the same broken scale.
    expect(subjectAt(60, overlapping)?.bandStatus).toBe('ok')
  })

  it('gives the emptied scale a name, across a whole class', () => {
    // THE VERIFIED FAILURE. Only the top band survives, so 68% is under a scale
    // that starts at 85 and 90% is the one subject that still grades. Before, all
    // three came back as `band: null, bandProblem: null` and the card drew a blank
    // badge beside two correctly graded neighbours.
    const emptied: TestBand[] = [band('level_6', 85, 100, 'Level 6')]
    const summary = computeAcademicSummary(
      [
        {
          subjectId: 'maths',
          percentage: 68,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
        {
          subjectId: 'english',
          percentage: 68,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
        {
          subjectId: 'science',
          percentage: 90,
          weight: 1,
          assessmentType: 'Classwork',
          assessmentTypeCode: 'CLASSWORK',
        },
      ],
      emptied,
    )
    const bySubject = new Map(summary.subjects.map((s) => [s.subjectId, s]))
    for (const subjectId of ['maths', 'english']) {
      const subject = bySubject.get(subjectId)
      expect(subject?.percentage).toBe(68)
      expect(subject?.band).toBeNull()
      expect(subject?.bandStatus).toBe('below-scale')
      expect(subject?.bandProblem).toBe('no band covers 0-84%')
    }
    // The subject that did grade keeps its band, and still names the scale's gap —
    // a partly broken scale is a fact about the school, not about one child.
    const science = bySubject.get('science')
    expect(science?.band?.key).toBe('level_6')
    expect(science?.bandStatus).toBe('ok')
    expect(science?.bandProblem).toBe('no band covers 0-84%')
  })

  it('states an interior hole only where it lands, and a coverage gap everywhere', () => {
    // Two different faults on two different terms, and the distinction is the
    // point: a hole is a range, so only the children inside it are affected, while
    // a scale that does not reach 0 is misconfigured in every subject it touches.
    const holed = subjectAt(75, mistyped)
    expect(holed?.band?.key).toBe('level_5')
    expect(holed?.bandProblem).toBeNull()

    const stopsAtFifty = subjectAt(72, [band('level_4', 50, 100, 'Level 4')])
    expect(stopsAtFifty?.band?.key).toBe('level_4')
    expect(stopsAtFifty?.bandProblem).toBe('no band covers 0-49%')
  })

  it('reports `no-percentage` for a subject with no percentage to band', () => {
    // Unreachable through `computeAcademicSummary`: every subject on the payload
    // holds at least one in-range mark and `resolveAssessmentWeight` never returns
    // a weight of zero, so the mean cannot be uncomposable. Asserted so the
    // discriminator stays total if that ever changes.
    const summary = computeAcademicSummary([], PRIMARY)
    expect(summary.subjects).toEqual([])
    expect(computeAcademicSummary([{ subjectId: 'maths', percentage: null, weight: 1 }], PRIMARY)
      .subjects).toEqual([])
  })
})