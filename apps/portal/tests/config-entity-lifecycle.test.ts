import { describe, it, expect, afterAll, beforeEach, mock, spyOn } from 'bun:test'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENTITY_CONFIG_MAP, SOFT_DELETE_ENTITY_TYPES } from '@novastar/shared-types'

/**
 * `softDelete: true` on an entity whose model has no `isActive` column 500s every
 * read, update and delete of that row.
 *
 * The flag is read by `config/[entityType]/[id]/route.ts`, which pushes
 * `isActive: true` into the where clause of its `findFirst`/`update`/`delete`; the
 * query engine rejects it as an unknown argument, and the route's catch only handles
 * `UnauthorizedError`/`ForbiddenError`/`ServerConfigError`. So the row was
 * unreachable rather than merely un-deletable. `grading_scale` was the one that
 * mattered: a school could create a grading scale and could then never read, edit or
 * retire one. POST was unaffected, which is why the Settings dialog looked like it
 * had saved.
 *
 * Eleven of the fourteen entities registered as soft-deletable had no such column,
 * and two more (`subject_level`, `fee_line_item`) carried the flag without being
 * registered at all. Adding the column to thirteen pre-existing models is a migration
 * and a design question about what retiring a row should do to the reports that
 * reference it, so those hard-delete and say so on their own entry instead.
 *
 * Both halves are proved here: the registry against the schema that backs it, and
 * the where-clause the route actually builds.
 */

// ---------------------------------------------------------------------------
// The schema, read rather than trusted
// ---------------------------------------------------------------------------

const SCHEMA_PATH = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'packages',
  'database',
  'prisma',
  'schema.prisma',
)

/**
 * Every field name every model declares, keyed by the model name lower-cased.
 *
 * Parsed out of `schema.prisma` rather than hand-listed, because a hand-list is
 * exactly what let this drift: the registry said `softDelete: true` and the schema
 * disagreed, and nothing compared the two. `@@unique`/`@@index` blocks and relation
 * lines are not fields, so both are skipped by requiring two spaces of indent and an
 * identifier. The registry names models in the delegate's camelCase and the schema
 * in PascalCase, so the key is lower-cased to join the two.
 */
function modelFields(): Map<string, Set<string>> {
  const source = readFileSync(SCHEMA_PATH, 'utf-8')
  const fields = new Map<string, Set<string>>()
  let current: Set<string> | null = null
  for (const line of source.split('\n')) {
    const model = /^model\s+(\w+)\s*\{/.exec(line)
    if (model) {
      current = new Set<string>()
      fields.set(model[1]!.toLowerCase(), current)
      continue
    }
    if (current === null) continue
    if (line.trim() === '}') {
      current = null
      continue
    }
    const field = /^ {2}(\w+)\s/.exec(line)
    if (field) current.add(field[1]!)
  }
  return fields
}

const FIELDS = modelFields()

function hasIsActive(model: string): boolean {
  return FIELDS.get(model.toLowerCase())?.has('isActive') ?? false
}

const softDeletable = Object.entries(ENTITY_CONFIG_MAP)
  .filter(([, config]) => config.softDelete)
  .map(([type]) => type)
  .sort()

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

// Bun's module-mock registry is process-global and outlives this file, so the
// factory must export every name `@/lib/tenant` exports that anything imports.
mock.module('@/lib/tenant', () => ({
  getTenantContext: async () => tenantContext,
  getTenantContextOrNull: async () => tenantContext,
  UnauthorizedError: MockUnauthorizedError,
  ForbiddenError: MockForbiddenError,
  ServerConfigError: MockServerConfigError,
}))

const actualAuth = await import('@novastar/auth')
mock.module('@novastar/auth', () => ({ ...actualAuth, hasPermission: async () => true }))

type Args = { where?: Record<string, unknown>; data?: Record<string, unknown> }

let storedRow: Record<string, unknown> | null = null
const findFirstCalls: Args[] = []
const updateCalls: Args[] = []
const deleteCalls: Args[] = []

const delegate = {
  findFirst: mock(async (args: Args) => {
    findFirstCalls.push(args)
    return storedRow
  }),
  update: mock(async (args: Args) => {
    updateCalls.push(args)
    return { ...(storedRow ?? {}), ...(args.data ?? {}) }
  }),
  delete: mock(async (args: Args) => {
    deleteCalls.push(args)
    return storedRow ?? {}
  }),
}

mock.module('server-only', () => ({}))
mock.module('@/lib/prisma', () => ({
  prisma: {
    gradingScale: delegate,
    assessmentTypeConfig: delegate,
    feeStructure: delegate,
    attendanceTaker: delegate,
  },
}))

const silencedError = spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => {
  silencedError.mockRestore()
})

const { GET, PATCH, DELETE } = await import('@/app/api/config/[entityType]/[id]/route')

function request(method: string, body: unknown, path: string) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const get = (entityType: string, id = 'row-1') =>
  GET(request('GET', {}, `/api/config/${entityType}/${id}`), {
    params: Promise.resolve({ entityType, id }),
  })

const patch = (entityType: string, body: unknown, id = 'row-1') =>
  PATCH(request('PATCH', body, `/api/config/${entityType}/${id}`), {
    params: Promise.resolve({ entityType, id }),
  })

const remove = (entityType: string, id = 'row-1') =>
  DELETE(request('DELETE', {}, `/api/config/${entityType}/${id}`), {
    params: Promise.resolve({ entityType, id }),
  })

beforeEach(() => {
  storedRow = null
  findFirstCalls.length = 0
  updateCalls.length = 0
  deleteCalls.length = 0
})

// ---------------------------------------------------------------------------
// The registry against the schema
// ---------------------------------------------------------------------------

describe('the soft-delete registry matches the models it describes', () => {
  it('declares softDelete only for a model that has an isActive column', () => {
    const wrong = Object.entries(ENTITY_CONFIG_MAP)
      .filter(([, config]) => config.softDelete !== hasIsActive(config.model))
      .map(([type, config]) => `${type} -> ${config.model} (softDelete: ${config.softDelete})`)
    expect(wrong).toEqual([])
  })

  it('registers exactly the entities that carry the flag', () => {
    // The two used to disagree in both directions: eleven models were registered
    // without the column, and `subject_level`/`fee_line_item` carried the flag
    // without being registered. Only the flag reaches the route, so both halves are
    // faults and the set is now exactly the flag.
    expect([...SOFT_DELETE_ENTITY_TYPES].sort()).toEqual(softDeletable)
  })

  it('lists the three models that genuinely have the column', () => {
    expect(
      softDeletable
        .map((type) => ENTITY_CONFIG_MAP[type]!.model)
        .filter((model) => hasIsActive(model))
        .sort(),
    ).toEqual(['assessmentTypeConfig', 'attendanceTaker', 'feeStructure'])
  })

  it('names a grading scale as hard-deleted, because GradingScale has no isActive column', () => {
    expect(hasIsActive('gradingScale')).toBe(false)
    expect(ENTITY_CONFIG_MAP.grading_scale?.softDelete).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The where-clause the route actually builds
// ---------------------------------------------------------------------------

describe('a grading scale is readable, editable and retirable again', () => {
  it('GET does not ask Prisma for a column the model does not have', async () => {
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', name: 'Ghana Primary', isDefault: true }

    const res = await get('grading_scale')

    expect(res.status).toBe(200)
    expect(findFirstCalls).toHaveLength(1)
    expect(findFirstCalls[0]!.where).toEqual({
      id: 'row-1',
      tenantId: 'tenant-1',
      schoolId: 'school-1',
    })
    expect(findFirstCalls[0]!.where).not.toHaveProperty('isActive')
  })

  it('PATCH writes the rename, and neither the lookup nor the update mentions isActive', async () => {
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', name: 'Ghana Primary', isDefault: true }

    const res = await patch('grading_scale', { name: 'Ghana Primary 2026' })

    expect(res.status).toBe(200)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!.data).toEqual({ name: 'Ghana Primary 2026' })
    for (const call of [...findFirstCalls, ...updateCalls]) {
      expect(call.where).not.toHaveProperty('isActive')
    }
  })

  it('DELETE hard-deletes rather than 500ing on an unknown argument', async () => {
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', name: 'Ghana Primary', isDefault: true }

    const res = await remove('grading_scale')
    const body = (await res.json()) as { softDeleted: boolean }

    expect(res.status).toBe(200)
    expect(body.softDeleted).toBe(false)
    expect(deleteCalls).toHaveLength(1)
    // A model without the column must not be handed `isActive = false` either.
    expect(updateCalls).toHaveLength(0)
    expect(deleteCalls[0]!.where).not.toHaveProperty('isActive')
  })

  it('still 404s a row from another school, so the fix did not widen the scope', async () => {
    // `buildScopeWhere` still carries id + tenantId + schoolId. Removing `isActive`
    // must not have removed the school clause with it.
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-2', name: 'Other school' }

    await get('grading_scale')

    expect(findFirstCalls[0]!.where).toEqual({
      id: 'row-1',
      tenantId: 'tenant-1',
      schoolId: 'school-1',
    })
  })
})

describe('a model that does have the column still soft-deletes', () => {
  it('filters on isActive and retires by writing false, not by removing the row', async () => {
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', code: 'QUIZ', isActive: true }

    const res = await remove('assessment_type')
    const body = (await res.json()) as { softDeleted: boolean }

    expect(res.status).toBe(200)
    expect(body.softDeleted).toBe(true)
    expect(findFirstCalls[0]!.where).toEqual({
      id: 'row-1',
      tenantId: 'tenant-1',
      schoolId: 'school-1',
      isActive: true,
    })
    expect(updateCalls[0]!.data).toEqual({ isActive: false })
    expect(deleteCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The other half of the same defect: a defaultWeight of 0 is not "excluded"
// ---------------------------------------------------------------------------

describe('a defaultWeight of 0 is refused where the teacher can act on it', () => {
  it('answers 400 with the reason and writes nothing', async () => {
    // `positiveWeight` rejects `<= 0`, so a stored 0 was read as the type carrying no
    // weight and fell through to 1 — the excluded component silently became an equal
    // share. The schema is the only place the teacher can be told, so it refuses 0
    // rather than storing something the arithmetic cannot honour.
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', code: 'QUIZ', defaultWeight: 0.1, isActive: true }

    const res = await patch('assessment_type', { defaultWeight: 0 })
    const body = (await res.json()) as {
      error: string
      issues: { defaultWeight?: { _errors?: string[] } }
    }

    expect(res.status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(body.issues.defaultWeight?._errors?.[0]).toContain('greater than 0')
    expect(body.issues.defaultWeight?._errors?.[0]).toContain('cannot exclude')
    // Refusal with no write, not a write followed by a warning.
    expect(updateCalls).toHaveLength(0)
    expect(deleteCalls).toHaveLength(0)
  })

  it('accepts a relative weight the old 0..1 cap refused', async () => {
    // Composition is a normalised weighted mean, so only the ratio matters, and the
    // column is `Decimal(3,2)` — 9.99, not 1.
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', code: 'FINAL', isActive: true }

    const res = await patch('assessment_type', { defaultWeight: 3 })

    expect(res.status).toBe(200)
    expect(updateCalls[0]!.data).toEqual({ defaultWeight: 3 })
  })

  it('refuses a weight the column cannot store, and says what the column is', async () => {
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', code: 'FINAL', isActive: true }

    const res = await patch('assessment_type', { defaultWeight: 10 })
    const body = (await res.json()) as {
      issues: { defaultWeight?: { _errors?: string[] } }
    }

    expect(res.status).toBe(400)
    expect(body.issues.defaultWeight?._errors?.[0]).toContain('9.99')
    expect(updateCalls).toHaveLength(0)
  })

  it('accepts the column ceiling itself', async () => {
    storedRow = { id: 'row-1', tenantId: 'tenant-1', schoolId: 'school-1', code: 'FINAL', isActive: true }

    const res = await patch('assessment_type', { defaultWeight: 9.99 })

    expect(res.status).toBe(200)
    expect(updateCalls[0]!.data).toEqual({ defaultWeight: 9.99 })
  })
})