/**
 * `sendEmail` with no `RESEND_API_KEY` in the environment.
 *
 * HISTORY: `getResend()` used to memoise its client before reading the
 * key, so the not-configured branch was unreachable once any test in the
 * process had sent a message. Within a single file only the accidental
 * execution order passed, and on CI — where the other test file ran
 * first and shared the module registry — the assertion failed.
 * `getResend()` now reads the key before the cached client, so this
 * passes in any position in any order. It stays its own file to keep
 * the never-configured case separate from the configured-then-unset
 * case guarded at the bottom of send-email.test.ts.
 */
import { describe, it, expect, mock } from 'bun:test'

// Set RESEND_API_KEY before any imports so getResend() doesn't throw
process.env.RESEND_API_KEY = 're_test_not_a_real_key'

mock.module('resend', () => ({
  Resend: class {
    constructor(apiKey: string) {
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('RESEND_API_KEY is not set')
      }
    }
    emails = {
      send: async (_payload: { from: string; to: string; subject: string }) => ({
        data: { id: 'msg_1' },
        error: null,
      }),
    }
  },
}))

mock.module('@novastar/database', () => ({
  prisma: {
    notification: { create: mock(async () => ({})) },
    user: { findMany: mock(async () => []) },
  },
}))

describe('sendEmail throws EmailDeliveryError when RESEND_API_KEY is unset', () => {
  it('throws not-configured with variable name', async () => {
    const saved = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY

    try {
      const mod = await import('@novastar/notifications')
      const err = await mod.sendEmail({
        to: 'x@example.test',
        subject: 's',
        text: 't',
      }).then(() => null, (e: unknown) => e)

      expect(err).toBeInstanceOf(mod.EmailDeliveryError)
      expect((err as InstanceType<typeof mod.EmailDeliveryError>).reason).toBe('not-configured')
      expect((err as Error).message).toContain('RESEND_API_KEY')
    } finally {
      process.env.RESEND_API_KEY = saved
    }
  })
})
