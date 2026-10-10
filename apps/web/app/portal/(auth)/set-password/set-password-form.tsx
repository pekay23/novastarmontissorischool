'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@novastar/shared-ui'
import { MIN_PASSWORD_LENGTH, meetsPasswordComplexity, PASSWORD_COMPLEXITY_LABEL } from '@/lib/password-policy'
import { signInLandingPath } from '@/lib/auth/signin-landing'

/**
 * The one-time setup link's page.
 *
 * Signing in after the write is done here, through `signIn('credentials')`, rather
 * than by having the route mint a session. One sign-in path means one set of
 * rules — lockout, account status, role gating — instead of a second copy of
 * them inside the route that could drift from `authorize()`.
 */
export function SetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('The two passwords do not match.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (!meetsPasswordComplexity(password)) {
      setError(`Your password must contain ${PASSWORD_COMPLEXITY_LABEL}.`)
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/portal/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.message ?? 'We could not set your password. Request a new invitation.')
        return
      }

      const email = body?.email
      if (!email) {
        // The password is stored and the address is verified; only the automatic
        // sign-in could not be attempted. Say so rather than implying failure.
        router.push('/portal/login')
        return
      }

      const result = await signIn('credentials', { redirect: false, email, password })
      if (result?.error) {
        router.push('/portal/login')
        return
      }
      router.push(signInLandingPath(result?.url ?? undefined, '/portal/dashboard'))
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set Your Password</CardTitle>
        <CardDescription>
          Choose a password of {PASSWORD_COMPLEXITY_LABEL}. It is never emailed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              New Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium mb-1">
              Confirm Password
            </label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy || !token}>
            {busy ? 'Setting your password…' : 'Set Password and Sign In'}
          </Button>
          {!token && (
            <p role="alert" className="text-sm text-destructive">
              This page needs a setup link. Open the link from your invitation email.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
