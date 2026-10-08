'use client'

import { useState } from 'react'
import type { TenantUserSummary } from '@/types/admin'
import { UserForm } from '@/components/user-form'

export function UserActions({
  user,
  tenantId,
  schools,
}: {
  user: TenantUserSummary
  tenantId: string
  schools: readonly { id: string; name: string }[]
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <UserForm
          tenantId={tenantId}
          userId={user.id}
          initial={{
            name: user.name,
            email: user.email,
            roleName: user.roleName,
            schoolId: user.schoolId,
            isActive: user.isActive,
          }}
          schools={schools}
          onSuccess={() => setEditing(false)}
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="h-7 rounded-md border border-input px-2 text-xs hover:bg-accent"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="h-7 rounded-md border border-input px-2 text-xs hover:bg-accent"
      >
        Edit
      </button>
      <form
        action={async () => {
          const action = user.isActive ? 'deactivate' : 'reactivate'
          if (!confirm(`${action === 'deactivate' ? 'Deactivate' : 'Reactivate'} user "${user.email}"?`)) return
          const endpoint = `/admin/api/tenants/${encodeURIComponent(tenantId)}/users/${encodeURIComponent(user.id)}`
          await fetch(endpoint, { method: user.isActive ? 'DELETE' : 'PATCH' })
          window.location.reload()
        }}
      >
        <button
          type="submit"
          className="h-7 rounded-md border border-input px-2 text-xs hover:bg-accent"
        >
          {user.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
      </form>
    </span>
  )
}
