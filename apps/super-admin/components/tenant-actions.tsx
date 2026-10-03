'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Suspend / reactivate for one tenant.
 *
 * Suspend is a one-way-looking button guarded by a typed confirmation, and it is
 * never a delete: `PATCH {"isActive": false}` flips one column and files an audit
 * entry. The confirmation asks for the tenant's code rather than "are you sure",
 * because the failure this guards against is an operator suspending the wrong
 * school in a list of similar names, and a yes/no dialog does not prevent that.
 */
export function TenantActions({
  tenantId,
  tenantCode,
  isActive,
  canUpdate,
}: {
  tenantId: string
  tenantCode: string
  isActive: boolean
  canUpdate: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')

  if (!canUpdate) {
    return <p className="text-xs text-muted-foreground">This operator cannot change tenant state.</p>
  }

  async function patch(body: Record<string, unknown>) {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const parsed: unknown = await response.json().catch(() => null)
        setError(
          typeof parsed === 'object' && parsed !== null && 'error' in parsed
            ? String((parsed as { error: unknown }).error)
            : 'The change was refused.',
        )
        return
      }
      setConfirming(false)
      setTyped('')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  if (isActive) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
        >
          {pending ? 'Working…' : 'Suspend tenant'}
        </button>
        {confirming ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
            <p className="text-xs">
              Suspending stops this tenant&rsquo;s portal sessions resolving. Nothing is deleted and
              the tenant keeps every row. Type <code className="font-mono">{tenantCode}</code> to
              confirm.
            </p>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              aria-label={`Type ${tenantCode} to confirm`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending || typed !== tenantCode}
                onClick={() => patch({ isActive: false })}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-60"
              >
                {pending ? 'Working…' : 'Suspend'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  setTyped('')
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => patch({ isActive: true })}
        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-60"
      >
        {pending ? 'Working…' : 'Reactivate tenant'}
      </button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
