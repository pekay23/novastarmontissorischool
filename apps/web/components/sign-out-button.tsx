'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Signs the operator out.
 *
 * A button rather than a form posting to the route, because the route is already
 * the whole mechanism: there is no client-side state to clear that the cookie
 * does not already hold, and clearing it in two places is how you end up with a
 * form that says "signed out" over a live session.
 */
export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onClick() {
    if (pending) return
    setPending(true)
    try {
      await fetch('/admin/api/auth/logout', { method: 'POST' })
      router.replace('/admin/login')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
