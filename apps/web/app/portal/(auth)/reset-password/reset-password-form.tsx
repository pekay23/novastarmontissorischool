'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@novastar/shared-ui'
import { MIN_PASSWORD_LENGTH, meetsPasswordComplexity, PASSWORD_COMPLEXITY_LABEL } from '@/lib/password-policy'
import { signInLandingPath } from '@/lib/auth/signin-landing'

/**
 * Chooses a new password from an emailed reset link.
 *
 * `error` is shown verbatim from the route, which distinguishes `expired` and
 * `spent` from `invalid` — all three are things the person can act on, and the
 * page gains nothing by flattening them into one message.
 */
export function ResetPasswordForm({ token }: { token: string | null }) {
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
      const res = await fetch('/portal/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.message ?? 'We could not reset your password. Request a new link.')
        return
      }

      const result = await signIn('credentials', {
        redirect: false,
        email: body?.email,
        password,
      })
      router.push(result?.error ? '/portal/login' : signInLandingPath(result?.url ?? undefined, '/portal/dashboard'))
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a New Password</CardTitle>
        <CardDescription>
          Your new password must be {PASSWORD_COMPLEXITY_LABEL}. Signing out of your
          other devices happens automatically.
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
            {busy ? 'Saving...' : 'Reset Password and Sign In'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => router.push('/portal/forgot-password')}
          >
            Request a New Link
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
