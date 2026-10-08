'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@novastar/shared-ui'

type SchoolFormData = {
  name: string
  code: string
  address: string
  phone: string
  email: string
  established: string
  motto: string | null | undefined
  logoUrl: string | null | undefined
}

const emptyForm: SchoolFormData = {
  name: '',
  code: '',
  address: '',
  phone: '',
  email: '',
  established: new Date().toISOString().split('T')[0],
  motto: '',
  logoUrl: '',
}

export function SchoolForm({
  tenantId,
  editId,
  initial,
  onSuccess,
}: {
  tenantId: string
  editId?: string
  initial?: Partial<SchoolFormData>
  onSuccess?: () => void
}) {
  const router = useRouter()
  const [form, setForm] = useState<SchoolFormData>({ ...emptyForm, ...initial })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = Boolean(editId)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const url = isEditing
        ? `/admin/api/tenants/${encodeURIComponent(tenantId)}/schools/${encodeURIComponent(editId!)}`
        : `/admin/api/tenants/${encodeURIComponent(tenantId)}/schools`
      const method = isEditing ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        name: form.name,
        code: form.code,
        address: form.address,
        phone: form.phone,
        email: form.email,
        established: form.established,
        motto: (form.motto ?? '').length > 0 ? form.motto : null,
        logoUrl: (form.logoUrl ?? '').length > 0 ? form.logoUrl : null,
      }

      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      const parsed: unknown = await response.json().catch(() => null)
      const body_ = (parsed ?? {}) as { error?: string }

      if (!response.ok) {
        setError(body_.error ?? 'Operation failed.')
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
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium">Code</label>
          <input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium">Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium">Address</label>
        <input
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium">Established</label>
          <input
            type="date"
            value={form.established}
            onChange={(e) => setForm({ ...form, established: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium">Motto (optional)</label>
          <input
            value={form.motto ?? ''}
            onChange={(e) => setForm({ ...form, motto: e.target.value })}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium">Logo URL (optional)</label>
        <input
          value={form.logoUrl ?? ''}
          onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending || !form.name || !form.code || !form.email || !form.phone || !form.address || !form.established}
          onClick={submit}
          className="h-9"
        >
          {pending ? (isEditing ? 'Saving…' : 'Creating…') : isEditing ? 'Save changes' : 'Create school'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onSuccess?.()}
          className="h-9"
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
