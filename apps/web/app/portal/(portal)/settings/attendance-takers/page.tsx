'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, useToast, Skeleton } from '@novastar/shared-ui'
import { Settings, RefreshCw, Shield, Trash2 } from 'lucide-react'

interface StaffRow {
  id: string
  firstName: string
  lastName: string
  employeeId: string
}

interface ClassRow {
  id: string
  name: string
}

interface GrantRow {
  staffId: string
  classId: string | null
  canMarkStudent: boolean
  canMarkStaff: boolean
  isActive: boolean
}

interface MatrixResponse {
  staff: StaffRow[]
  classes: ClassRow[]
  grants: GrantRow[]
}

/**
 * One cell of the matrix: `staffId` + the column, where the
 * school-wide column is the `classId: null` grant.
 */
function grantKey(staffId: string, classId: string | null): string {
  return `${staffId}|${classId ?? ''}`
}

export default function AttendanceTakersPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null)
  const [grants, setGrants] = useState<Record<string, GrantRow>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const role = (session?.user as { role?: string })?.role

  const fetchMatrix = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/attendance-takers')
      if (!res.ok) {
        if (res.status === 403) {
          toast.error({ title: 'Access denied', description: 'You must hold config:write to manage attendance takers.' })
        }
        return
      }
      const data: MatrixResponse = await res.json()
      setMatrix(data)
      const byKey: Record<string, GrantRow> = {}
      data.grants.forEach((g) => {
        byKey[grantKey(g.staffId, g.classId)] = g
      })
      setGrants(byKey)
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load attendance taker grants.' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (role === 'HEADMASTER') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchMatrix()
    }
  }, [role, fetchMatrix])

  if (role !== 'HEADMASTER') {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h1 className="text-3xl font-heading font-bold">Attendance Takers</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Only the Head of School can manage who may mark attendance.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  /**
   * Toggle one cell. The checkbox reflects the server's view
   * optimistically and is reverted if the write is refused, so
   * the matrix can never claim a grant the server does not hold.
   */
  const toggleGrant = async (staffId: string, classId: string | null, next: boolean) => {
    const key = grantKey(staffId, classId)
    const previous = grants[key]
    setGrants((prev) => ({
      ...prev,
      [key]: { staffId, classId, canMarkStudent: next, canMarkStaff: previous?.canMarkStaff ?? false, isActive: true },
    }))
    setSaving((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await fetch('/api/attendance-takers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, classId, canMarkStudent: next }),
      })
      if (!res.ok) {
        if (res.status === 403) {
          toast.error({ title: 'Access denied', description: 'You must hold config:write to manage attendance takers.' })
        } else {
          toast.error({ title: 'Error', description: 'Failed to save grant.' })
        }
        setGrants((prev) => {
          const copy = { ...prev }
          if (previous) copy[key] = previous
          else delete copy[key]
          return copy
        })
        return
      }
      const saved: GrantRow = await res.json()
      // Trust the server's row: it is the stored state, including
      // defaults this page did not send.
      setGrants((prev) => ({ ...prev, [grantKey(saved.staffId, saved.classId)]: saved }))
      toast.success({
        title: 'Saved',
        description: next
          ? 'Grant saved — attendance may be marked.'
          : 'Grant revoked for student attendance.',
      })
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save grant.' })
      setGrants((prev) => {
        const copy = { ...prev }
        if (previous) copy[key] = previous
        else delete copy[key]
        return copy
      })
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }))
    }
  }

  /**
   * Remove every grant a staff member holds. Each cell is its own
   * row (a class grant and the school-wide grant are distinct
   * rows), so releasing a staff member is one DELETE per row.
   */
  const revokeAll = async (staffId: string) => {
    const held = Object.values(grants).filter((g) => g.staffId === staffId)
    if (held.length === 0) return
    try {
      await Promise.all(
        held.map((g) =>
          fetch('/api/attendance-takers', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staffId, classId: g.classId }),
          }),
        ),
      )
      toast.success({ title: 'Removed', description: 'All attendance taker grants for this staff member were removed.' })
      void fetchMatrix()
    } catch {
      toast.error({ title: 'Error', description: 'Failed to remove grants.' })
    }
  }

  if (loading || !matrix) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <div>
            <h1 className="text-3xl font-heading font-bold">Attendance Takers</h1>
            <p className="text-sm text-muted-foreground">
              Who may mark student attendance, per class. The school-wide
              column grants every class at once.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMatrix}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Grant matrix</CardTitle>
          <CardDescription>
            Rows are staff, columns are classes. A checked box means that
            staff member may mark student attendance for that class.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b px-3 py-2 text-left font-medium text-muted-foreground">Staff</th>
                  {matrix.classes.map((c) => (
                    <th key={c.id} className="border-b px-3 py-2 text-center font-medium text-muted-foreground">
                      {c.name}
                    </th>
                  ))}
                  <th className="border-b px-3 py-2 text-center font-medium text-muted-foreground">
                    School-wide
                  </th>
                  <th className="border-b px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {matrix.staff.map((staff) => {
                  const held = Object.values(grants).filter((g) => g.staffId === staff.id)
                  return (
                    <tr key={staff.id}>
                      <td className="border-b px-3 py-2">
                        <div className="font-medium">
                          {staff.firstName} {staff.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">{staff.employeeId}</div>
                      </td>
                      {matrix.classes.map((c) => {
                        const key = grantKey(staff.id, c.id)
                        const grant = grants[key]
                        const checked = Boolean(grant?.canMarkStudent && grant.isActive)
                        return (
                          <td key={c.id} className="border-b px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              aria-label={`${staff.firstName} ${staff.lastName} may mark ${c.name}`}
                              checked={checked}
                              disabled={Boolean(saving[key])}
                              onChange={(e) => void toggleGrant(staff.id, c.id, e.target.checked)}
                              className="rounded"
                            />
                          </td>
                        )
                      })}
                      <td className="border-b px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${staff.firstName} ${staff.lastName} may mark every class`}
                          checked={Boolean(
                            grants[grantKey(staff.id, null)]?.canMarkStudent &&
                              grants[grantKey(staff.id, null)]?.isActive,
                          )}
                          disabled={Boolean(saving[grantKey(staff.id, null)])}
                          onChange={(e) => void toggleGrant(staff.id, null, e.target.checked)}
                          className="rounded"
                        />
                      </td>
                      <td className="border-b px-3 py-2 text-right">
                        {held.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void revokeAll(staff.id)}
                            aria-label={`Remove all grants for ${staff.firstName} ${staff.lastName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Badge variant="outline">No grants</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {matrix.staff.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">No staff found for this school.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
