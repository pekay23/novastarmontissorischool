import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { clientIdentifier, rateLimitByIPAsync } from '@/lib/rate-limit'
import { logError } from '@/lib/logger'

/**
 * `POST /api/newsletter/subscribe` — the public sign-up form in the site footer.
 *
 * This is the ONLY unauthenticated write path in the app, so everything it
 * accepts is attacker-controlled. Three things follow from that and are pinned
 * by the tests rather than left to the code below:
 *
 *   - The body is parsed by a schema before it reaches Prisma. `name` and
 *     `source` are unbounded strings to a database column otherwise, so a
 *     client could otherwise write megabytes of junk into `Newsletter`.
 *   - Requests are rate limited per address. Nothing else in the app is
 *     reachable without a session, so this is the endpoint a spam run hits.
 *   - A duplicate address answers 409, not 500. The check-then-write below is
 *     not atomic: two concurrent submits can both miss the read and the
 *     database's unique index rejects the second, which used to surface as an
 *     "internal error" for a perfectly ordinary outcome.
 *
 * `NewsletterSubscription` carries no `tenantId`. The deployment is one school
 * (ADR-024) and the list is the school's own, so the scoping columns were
 * removed in migration `20261011224609_newsletter_single_school`; reintroducing
 * them means resolving a tenant here AND dropping the global unique on `email`.
 */

const SubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  /** Optional: the footer omits it when the name field is left empty. */
  name: z.string().trim().max(120).optional(),
  /** Optional: defaults to `website`, matching the column default. */
  source: z.string().trim().min(1).max(64).optional(),
})

/** One person subscribes once, so this is a ceiling, not a throughput knob. */
const SUBSCRIBE_LIMIT = 5
const SUBSCRIBE_WINDOW_MS = 60 * 60 * 1000

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = SubscribeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const { email, name, source } = parsed.data

    const limited = await rateLimitByIPAsync(
      clientIdentifier(request),
      SUBSCRIBE_LIMIT,
      SUBSCRIBE_WINDOW_MS
    )
    if (!limited.success) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'retry-after': String(Math.ceil((limited.reset - Date.now()) / 1000)) } }
      )
    }

    // Decide and write in one transaction. The read-then-write on its own is
    // not atomic — two concurrent submits can both miss the read — so the
    // unique index on `email` remains the arbiter and its rejection is mapped
    // to 409 below. The transaction is what makes the outcome *coherent*: no
    // caller can observe a reactivation half-applied, and no reactivation can
    // interleave with the create it raced.
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.newsletterSubscription.findUnique({
        where: { email }
      })

      if (existing) {
        if (existing.isActive) return 'already-subscribed' as const
        // Reactivate if previously unsubscribed. An empty or omitted `name`/`source`
        // keeps what is stored: the footer submits the whole form, so silence is
        // "I left that blank", never "erase what you have".
        await tx.newsletterSubscription.update({
          where: { email },
          data: {
            isActive: true,
            name: name || existing.name,
            source: source || existing.source,
            unsubscribedAt: null,
          }
        })
        return 'reactivated' as const
      }

      await tx.newsletterSubscription.create({
        data: {
          email,
          name: name || null,
          source: source || 'website',
        }
      })
      return 'created' as const
    })

    if (outcome === 'already-subscribed') {
      return NextResponse.json(
        { error: 'This email is already subscribed' },
        { status: 409 }
      )
    }
    if (outcome === 'reactivated') {
      return NextResponse.json({ message: 'Subscription reactivated' })
    }
    return NextResponse.json({ message: 'Successfully subscribed' })
  } catch (error) {
    // The read above can lose a race, so the unique index rejecting a duplicate
    // is an ordinary outcome rather than a fault.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'This email is already subscribed' },
        { status: 409 }
      )
    }

    // The message only: an unhandled driver error can carry a connection
    // fragment, and this endpoint answers an anonymous caller.
    logError('Newsletter subscription', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: 'Failed to subscribe. Please try again.' },
      { status: 500 }
    )
  }
}
