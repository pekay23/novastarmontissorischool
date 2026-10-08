'use client'

import { useState } from 'react'
import { TenantForm } from '@/components/tenant-form'

export function TenantFormClient() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
      >
        Create tenant
      </button>
    )
  }

  return (
    <div className="rounded-md border p-4">
      <h3 className="mb-3 text-sm font-medium">New tenant</h3>
      <TenantForm onSuccess={() => setOpen(false)} />
    </div>
  )
}
