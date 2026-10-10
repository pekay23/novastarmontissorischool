'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@novastar/shared-ui'
import type { SchoolSummary } from '@/types/admin'
import { SchoolForm } from '@/components/school-form'

export function SchoolList({
  schools,
  canCreate,
  canUpdate,
  canDelete,
  tenantId,
}: {
  schools: readonly SchoolSummary[]
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
  tenantId: string
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editInitial, setEditInitial] = useState<Partial<SchoolSummary> | null>(null)

  const current = editId ? schools.find((s) => s.id === editId) ?? null : null

  if (schools.length === 0 && !showForm) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          This tenant has no schools.
        </p>
        {canCreate ? (
          <button
            type="button"
            onClick={() => { setEditId(null); setEditInitial(null); setShowForm(true) }}
            className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
          >
            Create school
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {canCreate && !showForm && !editId ? (
        <button
          type="button"
          onClick={() => { setEditId(null); setEditInitial(null); setShowForm(true) }}
          className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
        >
          Create school
        </button>
      ) : null}

      {showForm || editId ? (
        <div className="rounded-md border p-4">
          <h3 className="mb-3 text-sm font-medium">{editId ? 'Edit school' : 'New school'}</h3>
          <SchoolForm
            tenantId={tenantId}
            editId={editId ?? undefined}
            initial={editInitial ?? undefined}
            onSuccess={() => { setShowForm(false); setEditId(null); setEditInitial(null) }}
          />
        </div>
      ) : null}

      <Table>
        <TableCaption>
          {schools.length} {schools.length === 1 ? 'school' : 'schools'} in this tenant.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>School</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Established</TableHead>
            {(canUpdate || canDelete) ? <TableHead>Actions</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schools.map((school) => (
            <TableRow key={school.id}>
              <TableCell className="font-medium">{school.name}</TableCell>
              <TableCell className="font-mono text-xs">{school.code}</TableCell>
              <TableCell className="text-xs">
                <a className="hover:underline" href={`mailto:${school.email}`}>
                  {school.email}
                </a>
              </TableCell>
              <TableCell className="text-xs tabular-nums">{school.phone}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{school.address}</TableCell>
              <TableCell className="text-xs tabular-nums">
                {school.established.slice(0, 10)}
              </TableCell>
              {(canUpdate || canDelete) ? (
                <TableCell>
                  <div className="flex gap-1">
                    {canUpdate ? (
                      <button
                        type="button"
                        onClick={() => { setEditId(school.id); setEditInitial(school); setShowForm(false) }}
                        className="h-7 rounded-md border border-input px-2 text-xs hover:bg-accent"
                      >
                        Edit
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(`Delete school "${school.name}"? This cannot be undone.`)) return
                          await fetch(`/admin/api/tenants/${encodeURIComponent(tenantId)}/schools/${encodeURIComponent(school.id)}`, {
                            method: 'DELETE',
                          })
                          window.location.reload()
                        }}
                        className="h-7 rounded-md border border-destructive px-2 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
