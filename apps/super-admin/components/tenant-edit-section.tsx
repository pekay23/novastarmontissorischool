'use client'

import { useState } from 'react'
import { TenantForm } from '@/components/tenant-form'

export function TenantEditSection({
  tenant,
}: {
  tenant: { id: string; name: string; code: string; domain: string | null; settings: Record<string, unknown> }
}) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
      >
        Edit tenant
      </button>
    )
  }

  return (
    <div className="rounded-md border p-4">
      <h3 className="mb-3 text-sm font-medium">Edit tenant</h3>
      <TenantForm
        tenantId={tenant.id}
        initial={{
          name: tenant.name,
          code: tenant.code,
          domain: tenant.domain ?? '',
          settings: JSON.stringify(tenant.settings ?? {}, null, 2),
        }}
        onSuccess={() => setOpen(false)}
      />
    </div>
  )
}
