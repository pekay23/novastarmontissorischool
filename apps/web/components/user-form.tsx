'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@novastar/shared-ui'

export function UserForm({
  tenantId,
  userId,
  initial,
  schools,
  onSuccess,
}: {
  tenantId: string
  userId: string
  initial?: {
    name: string | null
    email: string
    roleName: string | null
    schoolId: string | null
    isActive: boolean
  }
  schools?: readonly { id: string; name: string }[]
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(initial?.name ?? '')
  const [roleName, setRoleName] = useState(initial?.roleName ?? '')
  const [schoolId, setSchoolId] = useState(initial?.schoolId ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/admin/api/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().length > 0 ? name.trim() : null,
          roleName,
          schoolId: schoolId || null,
          isActive,
        }),
      })

      const parsed: unknown = await response.json().catch(() => null)
      const body = (parsed ?? {}) as { error?: string }

      if (!response.ok) {
        setError(body.error ?? 'Update failed.')
        return
      }

      onSuccess?.()
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium">Email</label>
        <input
          value={initial?.email ?? ''}
          disabled
          className="h-9 w-full rounded-md border border-input bg-muted px-2 text-xs text-muted-foreground"
        />
        <p className="text-[10px] text-muted-foreground">Email cannot be changed.</p>
      </div>
      <div>
        <label className="text-xs font-medium">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium">Role</label>
          <input
            value={roleName}
            onChange={(e) => setRoleName(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium">School</label>
          <select
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">No school</option>
            {schools?.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="isActive"
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <label htmlFor="isActive" className="text-xs font-medium">
          Active
        </label>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="button" disabled={pending} onClick={submit} className="h-9">
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onSuccess?.()} className="h-9">
          Cancel
        </Button>
      </div>
    </div>
  )
}
