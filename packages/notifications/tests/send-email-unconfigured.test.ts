/**
 * `sendEmail` with no `RESEND_API_KEY` in the environment.
 *
 * WHY THIS IS ITS OWN FILE
 * ------------------------
 * `getResend()` memoises the client in a module-level variable, so within a
 * single file the not-configured branch is unreachable once any test has sent a
 * message: the cached client is returned and the key is never read again. The
 * original version of this test sat at the top of `send-email.test.ts` under a
 * comment saying it "MUST run first", which is a claim about the order Bun
 * happens to execute `describe` blocks in — nothing enforces it, and moving the
 * block to the bottom of that file made it fail.
 *
 * Bun gives every test file its own module registry, so a file of its own has no
 * ordering constraint to satisfy. Both file orders were run against this layout
 * and both pass; within one file, only the accidental one does.
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
