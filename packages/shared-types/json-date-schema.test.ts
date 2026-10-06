import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { JsonDateSchema } from './index'
import { ENTITY_CONFIG_MAP } from './entity-api-config'

/**
 * The JSON-boundary date regression.
 *
 * These schemas validate untrusted request bodies, and JSON has no date type — a
 * date on the wire is a string. Every schema below used to declare its date fields
 * as `z.date()`, which accepts only an actual `Date`, so every real client request
 * carrying a date came back 400 while in-process callers (the seed, tests) passed
 * and the suite stayed green. `JsonDateSchema` is the fix; these tests exist so
 * that swapping it back for `z.date()` — or for `z.coerce.date()`, which is worse,
 * because it stores silently wrong dates rather than refusing — fails here.
 */

/** A Date at an unknown-typed path, checked rather than asserted by `as`. */
function expectDate(value: unknown): Date {
  expect(value).toBeInstanceOf(Date)
  if (!(value instanceof Date)) throw new Error('expected a Date')
  return value
}

/**
 * The message a client actually sees.
 *
 * Both config routes answer a refused write with `error.format()`, not
 * `error.issues` (`apps/portal/app/api/config/[entityType]/route.ts`,
 * `[id]/route.ts`), and the settings UI flattens that tree in
 * `components/config/entity-list.tsx`. So this walks `format()`, not `issues` —
 * an assertion on `.issues` passes while the message is still withheld from every
 * client, which is exactly the bug it is here to catch. `JsonDateSchema` declares
 * its message on a refinement precisely because a `z.union`'s own `error` string
 * is discarded by `format()`.
 *
 * The flattening mirrors `issueLines`: `_errors` is the key Zod hangs a field's
 * own messages under, so it contributes the path rather than replacing it.
 */
function rejectionMessages(value: unknown, path: string[] = []): string[] {
  const result = JsonDateSchema.safeParse(value)
  expect(result.success).toBe(false)
  if (result.success) throw new Error('expected the parse to fail')
  return formatLines(result.error.format(), path)
}

/** Flattens a `format()` tree to `path: message` lines, as the UI does. */
function formatLines(node: unknown, path: string[]): string[] {
  if (node === null || typeof node !== 'object') return []
  const lines: string[] = []
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    // `_errors` is where Zod puts the messages belonging to `path` itself.
    const next = key === '_errors' ? path : [...path, key]
    if (Array.isArray(value)) {
      for (const message of value) {
        if (typeof message === 'string') {
          lines.push(next.length > 0 ? `${next.join('.')}: ${message}` : message)
        }
      }
      continue
    }
    lines.push(...formatLines(value, next))
  }
  return lines
}

/** The joined refusal a client would render, empty when nothing was withheld. */
function rejectionText(value: unknown): string {
  return rejectionMessages(value).join('; ')
}

/**
 * Whether a field is a date field, judged from its schema rather than its name.
 *
 * Two shapes count. `JsonDateSchema` (optionally wrapped) is a date field that is
 * already fixed. A bare `z.date()` is a date field that is NOT fixed — that is the
 * original defect — so it is recognised too, and fails below, which is the point.
 *
 * WRAPPERS ARE FOLLOWED RECURSIVELY, because the first version of this helper did
 * not and the gap was real: it unwrapped only `.optional()` and `.nullable()`, so
 * `z.array(z.date())`, `z.object({ from: z.date() })`, `z.date().default(...)` and
 * `.catch()` were all skipped in silence. `.default()` is not hypothetical — a
 * schema in this very registry already uses `.default('ACTIVE')`, so a date field
 * written that way next door would have been invisible. The sweep's count floor
 * could not catch it either: adding those three wrapped fields left `checked.length`
 * at 20, exactly the floor.
 *
 * Recursion, not a fixed unwrap chain, because nesting depth is unbounded in
 * principle (`z.array(z.object({ d: z.date() }))`) and a bounded walk only moves
 * the cliff. The visited set guards against a cyclic schema, which Zod permits to
 * be constructed even though nothing sane does.
 *
 * `.transform()` is deliberately not followed: it replaces the schema it is applied
 * to, so there is no date-shaped thing underneath to find, and following it would
 * mean guessing at an arbitrary function.
 */
function isDateFieldSchema(schema: z.ZodType, seen = new Set<z.ZodType>()): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)

  // Identity, not shape: `JsonDateSchema` is a ZodPipe whose generics are fixed at
  // its own declaration, so no common type parameter describes it and `z.ZodType`.
  // What is being asked is "is this the very schema standing where it sits", which
  // `===` answers without needing the two to be assignable to each other.
  if ((schema as unknown) === (JsonDateSchema as unknown)) return true
  if (schema instanceof z.ZodDate) return true

  const unwrapped = unwrapOnce(schema)
  return unwrapped === null ? false : isDateFieldSchema(unwrapped, seen)
}

/** The schema one combinator layer down, or `null` when this is a leaf. */
function unwrapOnce(schema: z.ZodType): z.ZodType | null {
  // Wrappers around a single inner schema.
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional
  ) {
    return schema.unwrap() as z.ZodType
  }
  // Wrappers around a collection.
  if (schema instanceof z.ZodArray) return schema.element as z.ZodType
  // Wrappers around named fields: any single one of them being a date makes this a
  // date-bearing field, so the check runs over all of them.
  if (schema instanceof z.ZodObject) {
    return Object.values(schema.shape).some((field) => isDateFieldSchema(field))
      ? (schema as z.ZodType)
      : null
  }
  return null
}

describe('JsonDateSchema — the wire form', () => {
  it('parses an ISO datetime to the exact instant, not merely a Date', () => {
    const parsed = JsonDateSchema.parse('2026-09-01T00:00:00.000Z')
    expectDate(parsed)
    expect(parsed.getTime()).toBe(Date.UTC(2026, 8, 1, 0, 0, 0, 0))
    expect(parsed.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('preserves sub-second precision rather than truncating to the second', () => {
    const parsed = JsonDateSchema.parse('2026-09-01T10:20:30.123Z')
    expect(parsed.toISOString()).toBe('2026-09-01T10:20:30.123Z')
  })

  it('honours a UTC offset instead of ignoring it', () => {
    // 10:00 at +02:00 is 08:00 UTC. Reading the digits and dropping the offset
    // would land four hours late.
    const parsed = JsonDateSchema.parse('2026-09-01T10:00:00+02:00')
    expect(parsed.toISOString()).toBe('2026-09-01T08:00:00.000Z')
  })

  it("accepts the date-only form the portal's <input type=\"date\"> submits", () => {
    // config-schema.ts declares academic_year/term dates as `type: 'date'`, and
    // entity-form.tsx renders that as <input type="date">, which posts "2026-09-01".
    // A datetime-only validator would leave every settings-form save still broken.
    const parsed = JsonDateSchema.parse('2026-09-01')
    expect(parsed.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it("accepts the zone-less form the portal's <input type=\"datetime-local\"> submits", () => {
    // `type: 'datetime'` renders as <input type="datetime-local">, which posts
    // "2026-09-01T08:30". A zone-less string means local time by ECMAScript, so the
    // expectation is stated against the same construction rather than a fixed
    // instant — this asserts acceptance, and asserts the instant is the local one.
    const parsed = JsonDateSchema.parse('2026-09-01T08:30')
    expect(parsed.getTime()).toBe(new Date('2026-09-01T08:30').getTime())
  })
})

describe('JsonDateSchema — refuses rather than guesses', () => {
  it('rejects a garbage string, with a message naming the expected format', () => {
    // Asserted on format() because that is what the route sends. The actionable
    // sentence has to survive that call, not merely exist on the error object.
    const message = rejectionText('not-a-date')
    expect(message).toContain('ISO-8601')
    expect(message).toContain('2026-09-01T00:00:00.000Z')
  })

  it('still names the accepted formats when read the way the settings UI reads it', () => {
    // The UI prefixes a field path onto its own messages, so the sentence must
    // survive being nested one level down rather than only at the root.
    const result = ENTITY_CONFIG_MAP.student.createSchema.safeParse({
      admissionNumber: 'ADM-2026-0001',
      firstName: 'Ama',
      lastName: 'Owusu',
      gender: 'FEMALE',
      dateOfBirth: 'not-a-date',
      classId: 'clx0000000000000000000002',
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected the parse to fail')

    const lines: string[] = []
    for (const [key, value] of Object.entries(result.error.format())) {
      if (key === '_errors') continue
      lines.push(...formatLines(value, ['dateOfBirth']))
    }
    expect(lines.join('; ')).toContain('ISO-8601')
  })

  it('rejects the strings Date.parse waves through but no caller means', () => {
    // Both of these produce a valid Date from `new Date(...)`, which is exactly why
    // the helper validates the format instead of trying the constructor.
    expect(new Date('2026').toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(new Date('Sep 1 2026').toISOString()).toBe('2026-09-01T00:00:00.000Z')

    expect(JsonDateSchema.safeParse('2026').success).toBe(false)
    expect(JsonDateSchema.safeParse('Sep 1 2026').success).toBe(false)
  })

  it('rejects an out-of-range datetime that is well-shaped but impossible', () => {
    expect(JsonDateSchema.safeParse('2026-13-45T99:99:99Z').success).toBe(false)
  })

  it('does NOT silently coerce the epoch cases — the bug a coercion fix would add', () => {
    // `z.coerce.date()` runs the input through `new Date(...)`, and these all
    // succeed: null -> 1970-01-01, 0 -> 1970-01-01, 1 -> 1970-01-01T00:00:00.001Z,
    // true -> the same. A client sending `null` for a nullable-looking field would
    // get a row stamped at the epoch with no error anywhere. These must fail.
    expect(new Date(null as unknown as string).toISOString()).toBe('1970-01-01T00:00:00.000Z')
    expect(new Date(0 as unknown as string).toISOString()).toBe('1970-01-01T00:00:00.000Z')
    expect(new Date(1 as unknown as string).toISOString()).toBe('1970-01-01T00:00:00.001Z')

    for (const hostile of [null, 0, 1, true, false, '']) {
      const result = JsonDateSchema.safeParse(hostile)
      expect(result.success, `${JSON.stringify(hostile)} must be rejected`).toBe(false)
    }
  })

  it('rejects a bare epoch millisecond number rather than reading it as an instant', () => {
    expect(new Date(1756684800000 as unknown as string).toISOString()).toBe('2025-09-01T00:00:00.000Z')
    expect(JsonDateSchema.safeParse(1756684800000).success).toBe(false)
  })

  it('rejects values that are not dates at all', () => {
    for (const hostile of [{}, [], '   ', undefined, NaN]) {
      expect(JsonDateSchema.safeParse(hostile).success).toBe(false)
    }
  })
})

describe('JsonDateSchema — internal callers keep working', () => {
  it('accepts a real Date and returns the SAME instance, not a copy', () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    const parsed = JsonDateSchema.parse(now)
    expect(parsed).toBe(now)
  })

  it('accepts a Date whose instant carries local-timezone state', () => {
    const now = new Date()
    expect(JsonDateSchema.parse(now)).toBe(now)
  })

  it('composes with .optional()', () => {
    expect(JsonDateSchema.optional().parse(undefined)).toBeUndefined()
    expect(JsonDateSchema.optional().safeParse(null).success).toBe(false)
    expect(JsonDateSchema.optional().safeParse('garbage').success).toBe(false)

    const now = new Date('2026-09-01T00:00:00.000Z')
    expect(JsonDateSchema.optional().parse(now)).toBe(now)
  })

  it('composes with .nullable()', () => {
    expect(JsonDateSchema.nullable().parse(null)).toBeNull()
    expect(JsonDateSchema.nullable().safeParse('garbage').success).toBe(false)

    const parsed = expectDate(JsonDateSchema.nullable().parse('2026-09-01'))
    expect(parsed.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('composes with .nullable().optional() — the shape publishedAt needs', () => {
    const schema = JsonDateSchema.nullable().optional()
    expect(schema.parse(undefined)).toBeUndefined()
    expect(schema.parse(null)).toBeNull()
    expect(schema.safeParse(0).success).toBe(false)
    expect(expectDate(schema.parse('2026-09-01')).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// The regression that matters: the real request bodies, through the real schemas
// ---------------------------------------------------------------------------

describe('config entity write paths accept a JSON body (end-to-end)', () => {
  it('CREATEs an academic_year from the body the settings form posts', () => {
    // The create schema is derived from AcademicYearSchema in entity-schemas.ts,
    // so this is the half a fix confined to entity-api-config.ts cannot reach.
    const body = {
      name: '2026/2027',
      startDate: '2026-09-01',
      endDate: '2027-07-31',
      isCurrent: true,
    }
    const result = ENTITY_CONFIG_MAP.academic_year.createSchema.safeParse(body)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))

    const { startDate, endDate } = result.data
    expect(expectDate(startDate).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(expectDate(endDate).toISOString()).toBe('2027-07-31T00:00:00.000Z')
    // Still a Date for Prisma, which is the whole reason the schema transforms.
    expect(startDate).toBeInstanceOf(Date)
  })

  it('CREATEs a term from the body the settings form posts', () => {
    const body = {
      name: 'Term 1',
      academicYearId: 'clx0000000000000000000001',
      startDate: '2026-09-01',
      endDate: '2026-12-18',
      status: 'ACTIVE',
      weeks: 14,
    }
    const result = ENTITY_CONFIG_MAP.term.createSchema.safeParse(body)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))

    expect(expectDate(result.data.startDate).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(expectDate(result.data.endDate).toISOString()).toBe('2026-12-18T00:00:00.000Z')
  })

  it('UPDATEs an academic_year by PATCH body', () => {
    // The update schema is a standalone object, not derived from the base, so it
    // carries its own copies of the bug and is a separate fix site.
    const result = ENTITY_CONFIG_MAP.academic_year.updateSchema.safeParse({
      startDate: '2026-09-01',
      endDate: '2027-07-31',
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))
    expect(expectDate(result.data.startDate).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('UPDATEs a term by PATCH body', () => {
    const result = ENTITY_CONFIG_MAP.term.updateSchema.safeParse({
      startDate: '2026-09-01',
      status: 'ACTIVE',
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))
    expect(expectDate(result.data.startDate).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('CREATEs a student — the endpoint apps/portal tests could not reach', () => {
    // tests/config-parent-scope.test.ts documents that "a student cannot be created
    // through this endpoint at all" because dateOfBirth is z.date(), and works
    // around it by passing new Date(...) objects instead of a JSON body. This is
    // that assertion, sent as the wire format the limitation describes.
    const body = {
      admissionNumber: 'ADM-2026-0001',
      firstName: 'Ama',
      lastName: 'Owusu',
      gender: 'FEMALE',
      dateOfBirth: '2016-03-14',
      admissionDate: '2026-09-01T00:00:00.000Z',
      classId: 'clx0000000000000000000002',
    }
    const result = ENTITY_CONFIG_MAP.student.createSchema.safeParse(body)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))

    expect(expectDate(result.data.dateOfBirth).toISOString()).toBe('2016-03-14T00:00:00.000Z')
    expect(expectDate(result.data.admissionDate).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })

  it('UPDATEs a student by PATCH body', () => {
    const result = ENTITY_CONFIG_MAP.student.updateSchema.safeParse({ dateOfBirth: '2016-03-14' })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))
    expect(expectDate(result.data.dateOfBirth).toISOString()).toBe('2016-03-14T00:00:00.000Z')
  })

  it('CREATEs an event from the datetime-local form its editor posts', () => {
    const body = {
      title: 'Founders Day',
      startDate: '2026-09-01T08:30',
      endDate: '2026-09-01T16:00',
    }
    const result = ENTITY_CONFIG_MAP.event.createSchema.safeParse(body)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error.issues.map((i) => i.message).join('; '))

    expect(expectDate(result.data.startDate).getTime()).toBe(new Date('2026-09-01T08:30').getTime())
    expect(expectDate(result.data.endDate).getTime()).toBe(new Date('2026-09-01T16:00').getTime())
  })

  it('publishes news, where the field is nullable and a Date must still be accepted', () => {
    const viaString = ENTITY_CONFIG_MAP.news.createSchema.safeParse({
      title: 'Term opens',
      publishedAt: '2026-09-01T00:00:00.000Z',
    })
    expect(viaString.success).toBe(true)
    if (viaString.success) {
      expect(expectDate(viaString.data.publishedAt).toISOString()).toBe('2026-09-01T00:00:00.000Z')
    }

    expect(ENTITY_CONFIG_MAP.news.createSchema.safeParse({ title: 'Draft', publishedAt: null }).success).toBe(true)

    // The internal-caller path: a real Date is still accepted, unchanged.
    const when = new Date('2026-09-01T00:00:00.000Z')
    const viaDate = ENTITY_CONFIG_MAP.news.createSchema.safeParse({ title: 'Term opens', publishedAt: when })
    expect(viaDate.success).toBe(true)
    if (viaDate.success) expect(viaDate.data.publishedAt).toBe(when)
  })

  it("hires staff, and refuses a hire date of 0 rather than hiring them in 1970", () => {
    const created = ENTITY_CONFIG_MAP.staff.createSchema.safeParse({
      employeeId: 'EMP-001',
      firstName: 'Kofi',
      lastName: 'Mensah',
      gender: 'MALE',
      hireDate: '2026-01-05',
      roleId: 'clx0000000000000000000003',
    })
    expect(created.success).toBe(true)
    if (created.success) {
      expect(expectDate(created.data.hireDate).toISOString()).toBe('2026-01-05T00:00:00.000Z')
    }

    // The coercion hazard, on a real endpoint, where it would persist a row.
    const epoch = ENTITY_CONFIG_MAP.staff.createSchema.safeParse({
      employeeId: 'EMP-002',
      firstName: 'Ama',
      lastName: 'Serwaa',
      gender: 'FEMALE',
      hireDate: 0,
      roleId: 'clx0000000000000000000003',
    })
    expect(epoch.success).toBe(false)
  })
})

describe('the fix is at the schemas, not at the callers', () => {
  it('a bare z.date() still rejects the wire form — which is what was broken', () => {
    // Documents the original defect and guards against a "fix" that quietly
    // reintroduces z.date() here while leaving the schemas untouched.
    expect(z.date().safeParse('2026-09-01').success).toBe(false)
    expect(JsonDateSchema.safeParse('2026-09-01').success).toBe(true)
  })

  it('every registry entity that declares a date field accepts the wire form', () => {
    // A sweep rather than a hand-written list, so the next date field added to the
    // registry is covered by this test the day it is written. It probes each date
    // field's own schema where it sits rather than parsing a whole entity body,
    // because a synthetic body would also have to satisfy every unrelated required
    // field (`name`, `classId`, …) and would then be testing those, not this.
    //
    // The fields are DISCOVERED, not listed. An earlier version named six of them
    // and claimed the next one would be covered for free; it would not — a field
    // called `exitDate` or `dateOfExit` slipped straight past while the suite stayed
    // green. A field counts as a date field when its schema is `JsonDateSchema`, or
    // when it is `z.date()` and so is the very thing this file exists to catch. That
    // second half is the load-bearing half: a newly declared date is recognised by
    // being WRONG, which is the state worth failing on.
    const checked: string[] = []

    for (const [type, config] of Object.entries(ENTITY_CONFIG_MAP)) {
      for (const schemaName of ['createSchema', 'updateSchema'] as const) {
        const schema = config[schemaName]
        // `instanceof` rather than reaching for `.shape` behind a cast: the registry
        // stores every schema as an opaque ZodType, and this is the narrowing that
        // checks it really is an object schema before reading its shape.
        if (!(schema instanceof z.ZodObject)) continue

        for (const [field, fieldSchema] of Object.entries(schema.shape)) {
          if (!isDateFieldSchema(fieldSchema)) continue

          const result = fieldSchema.safeParse('2026-09-01T00:00:00.000Z')
          expect(
            result.success,
            `${type}.${schemaName}.${field} rejected an ISO date string`,
          ).toBe(true)
          if (result.success) {
            expect(expectDate(result.data).toISOString()).toBe('2026-09-01T00:00:00.000Z')
          }
          checked.push(`${type}.${schemaName}.${field}`)
        }
      }
    }

    // Guards the sweep itself: an empty list would pass vacuously. The floor is the
    // count observed across the registry today (20 sites), not a rounder number that
    // happens to pass — a guard set below the real count lets a field go unpinned
    // while the suite stays green, which is the failure this whole sweep exists to
    // prevent. Drop a site from the registry and this fails loudly, asking whether
    // the removal was intended.
    expect(checked.length).toBeGreaterThanOrEqual(20)
    expect(new Set(checked).size).toBe(checked.length)
  })
})