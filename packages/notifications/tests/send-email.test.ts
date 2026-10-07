// The unconfigured-key case lives in `send-email-unconfigured.test.ts`.
// It used to have to: `getResend()` cached its client in a module-level
// variable before reading the key, so within one file the not-configured
// assertion was only reachable until the first successful send — declared
// first it passed by luck of ordering, declared last it failed. `getResend()`
// now reads the key first, so the case below (unset after a memoized send)
// passes in any position, and the file split is organizational, not
// load-bearing.
import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test'

// Set RESEND_API_KEY before any imports so getResend() doesn't throw
process.env.RESEND_API_KEY = 're_test_not_a_real_key'

const SENT: Array<{ from: string; to: string; subject: string }> = []

mock.module('resend', () => ({
  Resend: class {
    constructor(apiKey: string) {
      if (!apiKey || apiKey.trim().length === 0) {
        throw new Error('RESEND_API_KEY is not set')
      }
    }
    emails = {
      send: async (payload: { from: string; to: string; subject: string; html?: string; text?: string }) => {
        SENT.push({ from: payload.from, to: Array.isArray(payload.to) ? payload.to[0] : payload.to, subject: payload.subject })
        return { data: { id: 'msg_1' }, error: null }
      },
    }
  },
}))

mock.module('@novastar/database', () => ({
  prisma: {
    notification: { create: mock(async () => ({})) },
    user: { findMany: mock(async () => []) },
  },
}))

let sendEmail: typeof import('@novastar/notifications').sendEmail

beforeEach(async () => {
  SENT.length = 0
  delete process.env.MAIL_FROM
})

afterEach(() => {
  delete process.env.MAIL_FROM
})

describe('sendEmail from-address resolution', () => {
  beforeEach(async () => {
    // Ensure the module is loaded with a valid key for the resolution tests
    const mod = await import('@novastar/notifications')
    sendEmail = mod.sendEmail
  })

  it('uses explicit options.from when provided', async () => {
    await sendEmail({
      to: 'recipient@example.test',
      subject: 'Test',
      text: 'Body',
      from: 'Explicit Sender <explicit@example.test>',
    })

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.from).toBe('Explicit Sender <explicit@example.test>')
  })

  it('uses MAIL_FROM when no options.from is given', async () => {
    process.env.MAIL_FROM = 'Env Sender <env@example.test>'

    await sendEmail({
      to: 'recipient@example.test',
      subject: 'Test',
      text: 'Body',
    })

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.from).toBe('Env Sender <env@example.test>')
  })

  it('falls back to DEFAULT_FROM when neither options.from nor MAIL_FROM is set', async () => {
    delete process.env.MAIL_FROM

    await sendEmail({
      to: 'recipient@example.test',
      subject: 'Test',
      text: 'Body',
    })

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.from).toBe('Novastar Montessori <noreply@novastarmontessori.com>')
  })

  it('treats empty MAIL_FROM as unset and falls back to DEFAULT_FROM', async () => {
    process.env.MAIL_FROM = ''

    await sendEmail({
      to: 'recipient@example.test',
      subject: 'Test',
      text: 'Body',
    })

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.from).toBe('Novastar Montessori <noreply@novastarmontessori.com>')
  })

  it('treats whitespace-only MAIL_FROM as unset and falls back to DEFAULT_FROM', async () => {
    process.env.MAIL_FROM = '   '

    await sendEmail({
      to: 'recipient@example.test',
      subject: 'Test',
      text: 'Body',
    })

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.from).toBe('Novastar Montessori <noreply@novastarmontessori.com>')
  })

  it('options.from overrides MAIL_FROM', async () => {
    process.env.MAIL_FROM = 'Env Sender <env@example.test>'

    await sendEmail({
      to: 'recipient@example.test',
      subject: 'Test',
      text: 'Body',
      from: 'Override Sender <override@example.test>',
    })

    expect(SENT).toHaveLength(1)
    expect(SENT[0]!.from).toBe('Override Sender <override@example.test>')
  })

  it('throws not-configured when the key is unset after a send has memoized the client', async () => {
    // A successful send memoizes the Resend client. The key check must
    // still run on every send: a cached client must not make the
    // not-configured state unreachable for the rest of the process, which
    // is what made the unconfigured case pass or fail depending on which
    // test file ran first (the CI failure this guards against).
    await sendEmail({
      to: 'recipient@example.test',
      subject: 'Test',
      text: 'Body',
    })

    const saved = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY

    try {
      const { EmailDeliveryError } = await import('@novastar/notifications')
      const err = await sendEmail({
        to: 'recipient@example.test',
        subject: 'Test',
        text: 'Body',
      }).then(() => null, (e: unknown) => e)

      expect(err).toBeInstanceOf(EmailDeliveryError)
      expect((err as EmailDeliveryError).reason).toBe('not-configured')
    } finally {
      process.env.RESEND_API_KEY = saved
    }
  })
})