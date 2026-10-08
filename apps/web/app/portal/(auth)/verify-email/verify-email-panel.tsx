'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@novastar/shared-ui'

/**
 * The body of the verification page, as a client component because confirming the
 * link is a POST and the resend is a second one.
 *
 * Four outcomes are rendered, and the API distinguishes only two of them:
 *
 * - `verified`             the link was good and the address is now verified.
 * - `expired`              the link aged out; the API says so explicitly.
 * - `invalid`              covers both "never existed" and "already used". They
 *                          are genuinely indistinguishable — consumption clears
 *                          the column and nothing records that a token was ever
 *                          spent — and the copy names both possibilities rather
 *                          than guessing, because guessing wrong tells someone with
 *                          a working link that their address is unverified.
 * - `set-password-required` the account is mid-invitation and has no password,
 *                          so verifying alone would strand it. The link is handed
 *                          to the setup page unspent.
 */
type State = 'verifying' | 'verified' | 'expired' | 'invalid' | 'set-password' | 'error'

const MESSAGES: Record<State, string> = {
  verifying: 'Checking your link…',
  verified: 'Your email address is verified. You can sign in now.',
  expired:
    'This verification link has expired. Links last 24 hours — request a new one below.',
  invalid:
    'This verification link is no longer valid. It may have expired or already been used. Request a new one below.',
  // Transient: the panel is replacing itself with the setup page.
  'set-password': 'Taking you to set your password…',
  error: 'Something went wrong. Try again in a moment.',
}

export function VerifyEmailPanel({ token }: { token: string | null }) {
  const router = useRouter()
  const [state, setState] = useState<State>(token ? 'verifying' : 'invalid')
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)

  // The confirmation POST runs on mount. State is set from the response callback
  // rather than synchronously in the effect body, because this is synchronising
  // with an external system (the API) rather than deriving state from props.
  useEffect(() => {
    if (!token) return

    let cancelled = false
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => ({ res, body: await res.json().catch(() => null) }))
      .then(({ res, body }) => {
        if (cancelled) return
        if (!res.ok) {
          setState(body?.error === 'expired' ? 'expired' : 'error')
          return
        }
        if (body?.status === 'set-password-required') {
          setState('set-password')
          router.replace(`/set-password?token=${encodeURIComponent(token ?? '')}`)
          return
        }
        setState('verified')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [token, router])

  // Only rendered on a state the API can distinguish. Deliberate: the resend form
  // appears exactly when the link is dead, which is when a new one is worth
  // asking for.
  const showResend = state === 'expired' || state === 'invalid'

  async function handleResend(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setNotice('')
    const res = await fetch('/api/auth/verify-email/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const body = await res.json().catch(() => null)
    // The same sentence whatever the outcome: the endpoint does not confirm
    // whether an address has an account, and repeating that here is what stops
    // the page from becoming the oracle the route refuses to be.
    setNotice(body?.message ?? 'If that address has an unverified account, a new link is on its way.')
    setSending(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {state === 'verified' ? 'Email Verified' : 'Verify Your Email Address'}
        </CardTitle>
        <CardDescription>
          {state === 'verifying'
            ? 'Confirming your link…'
            : 'Confirming that this address is one you control.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state === 'verified' ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-muted-foreground">
              {MESSAGES.verified}
            </p>
            <Button className="w-full" onClick={() => router.push('/login')}>
              Continue to Sign In
            </Button>
          </div>
        ) : (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              {MESSAGES[state]}
            </p>

            {showResend && (
              <form onSubmit={handleResend} className="space-y-4 border-t pt-4">
                <p className="text-sm font-medium">Send a new verification link</p>
                <div>
                  <label htmlFor="resend-email" className="block text-sm font-medium mb-1">
                    Email
                  </label>
                  <Input
                    id="resend-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {notice && (
                  <p role="alert" className="text-sm text-muted-foreground">
                    {notice}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={sending}>
                  {sending ? 'Sending...' : 'Send New Link'}
                </Button>
              </form>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push('/login')}
            >
              Back to Sign In
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
