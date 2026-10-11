import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

/**
 * Cover for `POST /api/newsletter/subscribe`.
 *
 * This is the ONLY unauthenticated write path in the app, and it was written
 * without one: the create call left out the required `tenant` relation, so
 * `web#typecheck` failed until `NewsletterSubscription` lost its tenant scoping
 * (migration `20261011224609_newsletter_single_school`). Two obligations outlive
 * that fix and are what this file actually pins:
 *
 *   1. NO TENANT SCOPING IS REINTRODUCED. The schema is deliberately unscoped —
 *      `email` is globally unique and the list belongs to the one school
 *      (ADR-024). A test that lets `tenantId`/`schoolId`/`tenant`/`school` back
 *      into the write is the only thing standing between this and a future
 *      migration that re-adds the columns the route never supplies.
 *   2. THE ORDER IS VALIDATION, THEN LIMIT, THEN DATABASE. A rate limiter that
 *      runs after the read, or a schema that runs after the read, buys nothing:
 *      an abusive request still reaches Postgres. Each test below therefore
 *      asserts on the database call count as well as the status, because a
 *      refusal that still wrote is not a refusal.
 *
 * The rate limiter is the real one (`apps/web/lib/rate-limit.ts`, in-memory
 * fallback — no Upstash keys in tests). Stubbing it would let this file agree
 * with itself about a limit it invented.
 */

interface SubscriptionArgs {
  where?: Record<string, unknown>
  data?: Record<string, unknown>
}

/** A stored subscription, as the row the route reads back looks. */
interface StoredSubscription {
  id: string
  email: string
  isActive: boolean
  name: string | null
  source: string
  subscribedAt: Date
  unsubscribedAt: Date | null
}

function storedRow(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    id: 'sub-1',
    email: 'parent@example.com',
    isActive: true,
    name: 'A Parent',
    source: 'footer',
    subscribedAt: new Date('2026-04-14T09:00:00.000Z'),
    unsubscribedAt: null,
    ...overrides,
  }
}

const findUnique = mock(async (_args: SubscriptionArgs): Promise<StoredSubscription | null> => null)
const create = mock(async (_args: SubscriptionArgs): Promise<StoredSubscription> => storedRow())
const update = mock(async (_args: SubscriptionArgs): Promise<StoredSubscription> => storedRow())

/** Every write this route can make, so a refusal can be proven not to have made one. */
const SUBSCRIPTION_MODEL = { findUnique, create, update }
const ROOT_MODEL = { newsletterSubscription: SUBSCRIPTION_MODEL }

/**
 * What the create call is forbade to contain. Asserted by key rather than by a
 * snapshot of the whole `data`, so a future *addition* to the write does not
 * fail this test — only a reintroduced tenant scoping does.
 */
const FORBIDDEN_KEYS = ['tenantId', 'tenant', 'schoolId', 'school']

// ---------------------------------------------------------------------------
// Module-mock lifetime: snapshot before registering, restore after
// ---------------------------------------------------------------------------
// `mock.module` patches the live namespace for the whole process and never
// reverts, so the registration below has to be put back in `afterAll` or the
// next file in this suite binds to a client with one model on it. The spreads
// make each fake a superset of what it replaces, which is what makes the
// restore complete — an added key could never be removed again otherwise.
const previousPrisma = { ...(await import('@/lib/prisma')) }

mock.module('server-only', () => ({}))

mock.module('@/lib/prisma', () => ({
  ...previousPrisma,
  prisma: ROOT_MODEL,
}))

const { resetRateLimit } = await import('@/lib/rate-limit')
const { POST } = await import('@/app/api/newsletter/subscribe/route')

function subscribe(
  body: unknown,
  headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.7' },
): NextRequest {
  return new NextRequest('http://localhost/api/newsletter/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

function writeCalls(): number {
  return create.mock.calls.length + update.mock.calls.length
}

afterAll(() => {
  mock.module('@/lib/prisma', () => ({ ...previousPrisma }))
})

beforeEach(() => {
  // Re-registered per test rather than once at load: other files in this suite
  // register their own `@/lib/prisma` doubles in a shared `beforeEach`, and the
  // last one to run wins.
  mock.module('@/lib/prisma', () => ({
    ...previousPrisma,
    prisma: ROOT_MODEL,
  }))
  findUnique.mockReset()
  create.mockReset()
  update.mockReset()
  findUnique.mockImplementation(async () => null)
  create.mockImplementation(async () => storedRow())
  update.mockImplementation(async () => storedRow())
  resetRateLimit()
})

describe('POST /api/newsletter/subscribe', () => {
  it('creates the subscription with a normalised address and no tenant scoping', async () => {
    const res = await POST(subscribe({ email: '  Parent@Example.COM ', source: 'footer' }))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ message: 'Successfully subscribed' })

    expect(create).toHaveBeenCalledTimes(1)
    const data = create.mock.calls[0]![0].data!
    expect(data.email).toBe('parent@example.com')
    expect(data.source).toBe('footer')
    // The whole point of the schema change: the write carries nothing else.
    for (const key of FORBIDDEN_KEYS) {
      expect(Object.keys(data)).not.toContain(key)
    }
  })

  it('defaults the source when the client omits it', async () => {
    await POST(subscribe({ email: 'parent@example.com' }))

    expect(create.mock.calls[0]![0].data!.source).toBe('website')
  })

  it('rejects an invalid address before any database call', async () => {
    const res = await POST(subscribe({ email: 'not-an-address' }))

    expect(res.status).toBe(400)
    const body = await readJson(res)
    expect(body.error).toBe('Invalid input')
    expect(Array.isArray(body.details)).toBe(true)
    expect(findUnique).not.toHaveBeenCalled()
    expect(writeCalls()).toBe(0)
  })

  it('rejects a missing address rather than storing null', async () => {
    const res = await POST(subscribe({ name: 'No Email' }))

    expect(res.status).toBe(400)
    expect(writeCalls()).toBe(0)
  })

  it('rejects an unbounded name instead of writing it', async () => {
    const res = await POST(subscribe({ email: 'parent@example.com', name: 'x'.repeat(500) }))

    expect(res.status).toBe(400)
    expect(writeCalls()).toBe(0)
  })

  it('rejects a non-string source, which the column would otherwise coerce', async () => {
    const res = await POST(subscribe({ email: 'parent@example.com', source: 12345 }))

    expect(res.status).toBe(400)
    expect(writeCalls()).toBe(0)
  })

  it('answers 409 when the address is already subscribed', async () => {
    findUnique.mockImplementation(async () => storedRow({ isActive: true }))

    const res = await POST(subscribe({ email: 'parent@example.com' }))

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'This email is already subscribed' })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('reactivates a previously unsubscribed address, keeping what is stored', async () => {
    findUnique.mockImplementation(async () =>
      storedRow({ isActive: false, unsubscribedAt: new Date('2026-04-01T09:00:00.000Z') }),
    )

    const res = await POST(subscribe({ email: 'parent@example.com' }))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ message: 'Subscription reactivated' })

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    const { where, data } = update.mock.calls[0]![0]
    expect(where).toEqual({ email: 'parent@example.com' })
    expect(data).toMatchObject({
      isActive: true,
      unsubscribedAt: null,
      // Omitted by the subscriber, so the stored values survive.
      name: 'A Parent',
      source: 'footer',
    })
  })

  it('answers 409 rather than 500 when the unique index rejects a concurrent duplicate', async () => {
    // The read above is not atomic: two submits can both miss it. The second
    // write then fails on the index, which used to surface as an internal error.
    create.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.0',
      })
    })

    const res = await POST(subscribe({ email: 'parent@example.com' }))

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'This email is already subscribed' })
  })

  it('answers 429 past the per-address limit, and stops reaching the database', async () => {
    // The limit is five per hour, so five distinct addresses are accepted and a
    // sixth from the same address is refused.
    for (let i = 0; i < 5; i++) {
      const res = await POST(subscribe({ email: `parent${i}@example.com` }))
      expect(res.status).toBe(200)
    }

    const callsBefore = findUnique.mock.calls.length
    const res = await POST(subscribe({ email: 'parent-extra@example.com' }))

    expect(res.status).toBe(429)
    expect(findUnique.mock.calls.length).toBe(callsBefore)
    expect(writeCalls()).toBe(5)
  })

  it('answers 500 with a fixed body on an unexpected fault, naming nothing', async () => {
    create.mockImplementation(async () => {
      throw new Error('connection refused: postgresql://user:secret@db.neon.tech/neondb')
    })

    const res = await POST(subscribe({ email: 'parent@example.com' }))

    expect(res.status).toBe(500)
    const body = await readJson(res)
    expect(body).toEqual({ error: 'Failed to subscribe. Please try again.' })
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('does not require a session', async () => {
    // No auth header, no cookie, and the request still succeeds: this is the
    // public footer form. A future change that gates it must be deliberate.
    const res = await POST(subscribe({ email: 'parent@example.com' }, {}))

    expect(res.status).toBe(200)
  })
})
