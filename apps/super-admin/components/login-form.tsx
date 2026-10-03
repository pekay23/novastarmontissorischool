'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@novastar/shared-ui'

/**
 * The sign-in form.
 *
 * A client component because it holds the pending state and the error message; it
 * holds no credential state of its own beyond the two uncontrolled inputs, which
 * are cleared on a failed attempt so a mistyped password is not left sitting in a
 * field for the next try.
 *
 * The error it renders is whatever the server said, verbatim. There is no
 * client-side "no such operator" branch, because the server deliberately cannot
 * tell that case apart from a wrong password and inventing the distinction here
 * would put it back.
 */
export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // One field, because the server resolves a username or an address from
          // the same string. Two fields would make the client guess which one the
          // operator meant, and guess wrong in a way the server cannot report.
          identifier: String(data.get('identifier') ?? ''),
          password: String(data.get('password') ?? ''),
        }),
      })

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        const message =
          typeof body === 'object' && body !== null && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'Sign-in failed.'
        setError(message)
        form.reset()
        return
      }

      router.replace('/tenants')
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Sign-in refused</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {configured ? null : (
        <Alert variant="destructive">
          <AlertTitle>Not configured</AlertTitle>
          <AlertDescription>
            This console has no session signing secret configured, so no session can be
            signed or verified and no one can sign in. Set PLATFORM_SESSION_SECRET, then
            create an operator account with the tenant CLI. See the README.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <label htmlFor="identifier" className="text-sm font-medium">
          Username or email
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          disabled={pending || !configured}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending || !configured}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
      </div>

      <button
        type="submit"
        disabled={pending || !configured}
        className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
