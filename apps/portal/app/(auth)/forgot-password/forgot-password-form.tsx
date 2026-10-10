'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@novastar/shared-ui'

/**
 * Asks for an email address and reports the same sentence for every outcome.
 *
 * The route answers identically for an unknown address, a wrong school and a
 * delivery failure. Repeating that here is deliberate: a page that said "we could
 * not find that account" would reintroduce the account-existence oracle the
 * endpoint goes to the trouble of removing.
 */
export function ForgotPasswordForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        // 429 is not an error: the route answers the same generic body whether
        // the address exists or the request was throttled, so the message below
        // is correct for both. The Retry-After header is the only signal that
        // distinguishes them, and it is shown in the hint rather than surfacing
        // a raw number.
        const retryAfter = res.headers.get('Retry-After')
        setMessage(
          retryAfter
            ? `Too many attempts. Please wait ${retryAfter} seconds before trying again.`
            : 'We could not reach the server. Check your connection and try again.',
        )
        return
      }

      const body = await res.json().catch(() => null)
      setMessage(
        body?.message ?? 'If that address has an account, a password reset link is on its way. If you do not see it within a few minutes, contact your school office.',
      )
    } catch {
      setMessage('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset Your Password</CardTitle>
        <CardDescription>
          Enter the address on your account and we will email you a link to choose a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-1">
              Email
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
            />
          </div>

          {message && (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Sending...' : 'Send Reset Link'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => router.push('/login')}
          >
            Back to Sign In
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
