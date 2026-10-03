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
  const [schoolCode, setSchoolCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, schoolCode: schoolCode || undefined }),
      })
      const body = await res.json().catch(() => null)
      setMessage(
        body?.message ?? 'If that address has an account, a password reset link is on its way.'
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
            />
          </div>
          <div>
            <label htmlFor="schoolCode" className="block text-sm font-medium mb-1">
              School Code <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="schoolCode"
              name="schoolCode"
              type="text"
              autoComplete="organization"
              value={schoolCode}
              onChange={(e) => setSchoolCode(e.target.value)}
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
