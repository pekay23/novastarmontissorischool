'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@novastar/shared-ui'

type TenantFormData = {
  name: string
  code: string
  domain: string
  settings: string
  schoolName: string
  schoolCode: string
  schoolAddress: string
  schoolPhone: string
  schoolEmail: string
  schoolEstablished: string
  schoolMotto: string
  adminEmail: string
  adminPassword: string
  adminRoleName: string
}

const emptyForm: TenantFormData = {
  name: '',
  code: '',
  domain: '',
  settings: '{}',
  schoolName: '',
  schoolCode: '',
  schoolAddress: '',
  schoolPhone: '',
  schoolEmail: '',
  schoolEstablished: new Date().toISOString().split('T')[0],
  schoolMotto: '',
  adminEmail: '',
  adminPassword: '',
  adminRoleName: 'HEADMASTER',
}

export function TenantForm({ tenantId, initial, onSuccess }: { tenantId?: string; initial?: Partial<TenantFormData>; onSuccess?: (tenantId?: string) => void }) {
  const router = useRouter()
  const isEditing = Boolean(tenantId)
  const [form, setForm] = useState<TenantFormData>({ ...emptyForm, ...initial })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setPending(true)
    setError(null)
    try {
      let parsedSettings: Record<string, unknown> = {}
      try {
        parsedSettings = JSON.parse(form.settings || '{}')
      } catch {
        setError('Settings must be valid JSON.')
        setPending(false)
        return
      }

      const url = isEditing ? `/admin/api/tenants/${encodeURIComponent(tenantId!)}` : '/admin/api/tenants'
      const method = isEditing ? 'PATCH' : 'POST'

      const body: Record<string, unknown> = {
        tenant: {
          name: form.name,
          code: form.code,
          domain: form.domain.length > 0 ? form.domain : null,
          settings: parsedSettings,
        },
      }

      if (!isEditing) {
        body.school = {
          name: form.schoolName,
          code: form.schoolCode,
          address: form.schoolAddress,
          phone: form.schoolPhone,
          email: form.schoolEmail,
          established: form.schoolEstablished,
          motto: form.schoolMotto.length > 0 ? form.schoolMotto : undefined,
        }
        body.admin = {
          email: form.adminEmail,
          password: form.adminPassword,
          roleName: form.adminRoleName,
        }
      }

      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      const parsed: unknown = await response.json().catch(() => null)
      const body_ = (parsed ?? {}) as { error?: string; id?: string }

      if (!response.ok) {
        setError(body_.error ?? (isEditing ? 'Update failed.' : 'Tenant creation failed.'))
        return
      }

      onSuccess?.(body_.id)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{isEditing ? 'Edit tenant' : 'Tenant details'}</h3>
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
              disabled={isEditing}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium">Domain (optional)</label>
          <input
            value={form.domain}
            onChange={(e) => setForm({ ...form, domain: e.target.value })}
            placeholder="https://school.example.com"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs font-medium">Settings (JSON)</label>
          <textarea
            value={form.settings}
            onChange={(e) => setForm({ ...form, settings: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {!isEditing ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">First School</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium">Name</label>
              <input
                value={form.schoolName}
                onChange={(e) => setForm({ ...form, schoolName: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium">Code</label>
              <input
                value={form.schoolCode}
                onChange={(e) => setForm({ ...form, schoolCode: e.target.value })}
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
                value={form.schoolEmail}
                onChange={(e) => setForm({ ...form, schoolEmail: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium">Phone</label>
              <input
                value={form.schoolPhone}
                onChange={(e) => setForm({ ...form, schoolPhone: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Address</label>
            <input
              value={form.schoolAddress}
              onChange={(e) => setForm({ ...form, schoolAddress: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium">Established</label>
              <input
                type="date"
                value={form.schoolEstablished}
                onChange={(e) => setForm({ ...form, schoolEstablished: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium">Motto (optional)</label>
              <input
                value={form.schoolMotto}
                onChange={(e) => setForm({ ...form, schoolMotto: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        </div>
      ) : null}

      {!isEditing ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">First Administrator</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium">Email</label>
              <input
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium">Password</label>
              <input
                type="password"
                value={form.adminPassword}
                onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Role</label>
            <select
              value={form.adminRoleName}
              onChange={(e) => setForm({ ...form, adminRoleName: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="HEADMASTER">HEADMASTER</option>
              <option value="ASSISTANT_HEAD">ASSISTANT_HEAD</option>
              <option value="ADMIN_STAFF">ADMIN_STAFF</option>
            </select>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button
          type="button"
          disabled={
            pending ||
            !form.name ||
            !form.code ||
            (!isEditing && (!form.schoolName || !form.schoolCode || !form.schoolEmail || !form.schoolPhone || !form.schoolAddress || !form.schoolEstablished || !form.adminEmail || !form.adminPassword))
          }
          onClick={submit}
          className="h-9"
        >
          {pending ? (isEditing ? 'Saving…' : 'Creating…') : isEditing ? 'Save changes' : 'Create tenant'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => onSuccess?.()} className="h-9">
          Cancel
        </Button>
      </div>
    </div>
  )
}
