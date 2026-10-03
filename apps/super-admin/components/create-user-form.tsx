'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SetupEmailOutcome } from '@/types/admin'

/**
 * Creates one account in this tenant and mails it a one-time setup link.
 *
 * There is no password field, and that is the design rather than an omission: the
 * recipient chooses their own password through a single-use link, so no provisional
 * credential exists to leak from a mailbox, from this console's memory, or from an
 * audit entry. A form with a password box would also have to decide what to do when
 * the email fails after the account is created, which is the state this form does
 * surface instead.
 *
 * The form shows the delivery outcome rather than a bare success. "Created" and
 * "created, and the email did not go out" are different states for the operator —
 * the second one needs a human to re-send — and a control that reports both as done
 * is how a person spends a week waiting for a link that was never sent.
 */
export function CreateUserForm({
  tenantId,
  schools,
  roleNames,
  disabledReason,
}: {
  tenantId: string
  /** Only schools in this tenant. Rendered as a select, not free text. */
  schools: ReadonlyArray<{ id: string; name: string }>
  /** The seeded role names, so the operator cannot invent one. */
  roleNames: readonly string[]
  /** Rendered instead of the form when the operator cannot use it. */
  disabledReason?: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? '')
  const [roleName, setRoleName] = useState(roleNames[0] ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ email: string; setupEmail: SetupEmailOutcome } | null>(
    null,
  )

  if (disabledReason) {
    return <p className="text-xs text-muted-foreground">{disabledReason}</p>
  }

  if (schools.length === 0) {
    // Nothing to attach an account to. A user with no school has no role resolved and
    // no permission, so the account would exist and be locked out on first sign-in.
    return (
      <p className="text-xs text-muted-foreground">
        This tenant has no schools, so there is nowhere to put an account. Provision a school
        first.
      </p>
    )
  }

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          name: name.trim().length > 0 ? name.trim() : undefined,
          schoolId,
          roleName,
        }),
      })
      const parsed: unknown = await response.json().catch(() => null)
      const body = (parsed ?? {}) as {
        error?: string
        email?: string
        setupEmail?: SetupEmailOutcome
        setupEmailReason?: string | null
      }

      if (!response.ok) {
        setError(body.error ?? 'The account was not created.')
        return
      }

      // Reported even on a 502, which is the whole point: the account exists in both
      // cases and only one of them reached the recipient.
      setCreated({ email: body.email ?? email, setupEmail: body.setupEmail ?? 'sent' })
      setEmail('')
      setName('')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          placeholder="new.teacher@school.test"
          aria-label="Email address"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          type="text"
          placeholder="Name (optional)"
          aria-label="Name"
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={schoolId}
          onChange={(event) => setSchoolId(event.target.value)}
          aria-label="School"
          className="h-9 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
            </option>
          ))}
        </select>
        <select
          value={roleName}
          onChange={(event) => setRoleName(event.target.value)}
          aria-label="Role"
          className="h-9 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {roleNames.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || email.trim().length === 0 || schoolId === '' || roleName === ''}
          onClick={submit}
          className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        The account is created with no password. It gets a one-time link and chooses its own.
      </p>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {created ? (
        <p
          className={
            created.setupEmail === 'sent'
              ? 'text-xs text-muted-foreground'
              : 'text-xs text-destructive'
          }
        >
          {created.setupEmail === 'sent'
            ? `Invited ${created.email}. The setup link is on its way and expires in 24 hours.`
            : `Created ${created.email}, but the setup email was not delivered. The account exists ` +
              'with no password: re-issue the invitation rather than setting one here.'}
        </p>
      ) : null}
    </div>
  )
}