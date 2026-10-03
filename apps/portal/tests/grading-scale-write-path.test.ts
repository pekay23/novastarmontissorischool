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

const tenantContext = {
  tenantId: 'tenant-1',
  schoolId: 'school-1',
  userId: 'user-1',
}
let permissionGranted = true

// The factory must export every name `@/lib/tenant` exports that anything
// imports: Bun's module-mock registry is process-global and outlives this file,
// so a missing export breaks unrelated files that resolve the module afterwards.
mock.module('@/lib/tenant', () => ({
  getTenantContext: async () => tenantContext,
  getTenantContextOrNull: async () => tenantContext,
  UnauthorizedError: MockUnauthorizedError,
  ForbiddenError: MockForbiddenError,
  ServerConfigError: MockServerConfigError,
}))

const actualAuth = await import('@novastar/auth')
mock.module('@novastar/auth', () => ({
  ...actualAuth,
  hasPermission: async () => permissionGranted,
}))

/** The bands a read returns, and the calls the write path made. */
let storedBands: NamedGradeBand[] = []
let storedRow: Record<string, unknown> | null = null
const created: Array<Record<string, unknown>> = []
const updated: Array<Record<string, unknown>> = []
const deleted: Array<Record<string, unknown>> = []
/** How many times the route read a scale's bands. */
let bandReads = 0

const gradingLevelFindMany = mock(async () => {
  bandReads += 1
  return storedBands
})
const gradingLevelFindFirst = mock(async () => storedRow)
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

mock.module('server-only', () => ({}))
mock.module('@/lib/prisma', () => ({
  prisma: {
    gradingLevel: {
      findMany: gradingLevelFindMany,
      findFirst: gradingLevelFindFirst,
      create: gradingLevelCreate,
      update: gradingLevelUpdate,
      delete: gradingLevelDelete,
    },
    feeCategory: { create: feeCategoryCreate },
  },
}))

const silencedError = spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => {
  silencedError.mockRestore()
})

const { POST } = await import('@/app/api/config/[entityType]/route')
const { PATCH, DELETE } = await import('@/app/api/config/[entityType]/[id]/route')

beforeEach(() => {
  storedBands = PRIMARY.map((band) => ({ ...band }))
  storedRow = null
  permissionGranted = true
  created.length = 0
  updated.length = 0
  deleted.length = 0
  bandReads = 0
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

    expect(res.status).toBe(400)
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

    const afterWrite: NamedGradeBand[] = PRIMARY.map((band) =>
      band.key === 'level_4' ? { ...band, maxScore: 64 } : band,
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

  it('still clamps a score above the top band, which is off the scale and not a hole', () => {
    const narrow: TestBand[] = [
      band('low', 0, 49, 'Low'),
      band('high', 50, 69, 'High'),
    ]
    expect(keyFor(narrow, 85)).toBe('high')
    expect(keyFor(narrow, 1000)).toBe('high')
    // A scale that does not reach 100 has a ceiling, and crossing it is not a hole:
    // nothing beneath it is missing, the score has run off the end of the school's
    // scale and the top band is the last label the school defined.
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