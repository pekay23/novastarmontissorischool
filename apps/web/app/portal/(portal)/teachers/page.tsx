'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  Card, CardContent, CardHeader, CardTitle, Button, Badge,
  useToast, useConfirm,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
  Alert, AlertTitle, AlertDescription,
} from '@novastar/shared-ui'
import { Plus, Users, MoreHorizontal, Edit2, Trash2, RefreshCw, MailWarning } from 'lucide-react'
import { StaffForm, type StaffCreateResult } from '@/components/teachers/staff-form'

interface Teacher {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  phone: string
  email: string
  hireDate: string
  status: string
  role: { name: string } | null
  user: { name?: string | null; email?: string | null } | null
  createdAt: string
}

export default function TeachersPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const { data: session } = useSession()
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  /**
   * Whether this caller may create a staff member at all, and which portal roles
   * they may grant.
   *
   * From the server, not from the session, for the same reason
   * `promotions/page.tsx` asks for `canPromote`: permissions can arrive by
   * delegation, so a role check in the UI would hide the button from someone the
   * Head of School had explicitly granted it to. It also means the role list and
   * the route's privilege ceiling come from one table rather than two.
   *
   * Fail-closed default: `false` until the answer arrives, so the button never
   * flashes for a caller who will be refused.
   */
  const [canCreate, setCanCreate] = useState(false)
  const [grantableRoleNames, setGrantableRoleNames] = useState<string[]>([])

  /**
   * Set when an account was created but its setup email did not go out.
   *
   * Both halves of that are true, and only one of them is what the operator
   * expected: the person is in the directory and can sign in the moment they set a
   * password, but nobody told them how. It is a report of a real fault rather than
   * an error toast, so it is held here and rendered until it is dismissed — a
   * toast that disappears in five seconds would let the two outcomes blur into
   * "invited".
   */
  const [deliveryFailure, setDeliveryFailure] = useState<StaffCreateResult | null>(null)

  // The session user's own email, matched against each row's
  // `user.email` to decide which row is "me". Email is unique
  // per tenant (`User @@unique([tenantId, email])`), and the
  // staff list is tenant-scoped, so this identifies the session
  // user's Staff row without any extra request.
  const sessionEmail = (session?.user as { email?: string | null } | undefined)?.email ?? null

  const fetchTeachers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/portal/api/teachers')
      if (res.ok) {
        const data = await res.json()
        setTeachers(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load staff' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load staff' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  /**
   * What the create affordance is allowed to offer this caller.
   *
   * Fail closed on every path, including an unreadable answer: a button that
   * appears for somebody the route will refuse is worse than an absent one.
   */
  const fetchCreateCapability = useCallback(async () => {
    try {
      const res = await fetch('/portal/api/teachers/invite')
      if (!res.ok) {
        setCanCreate(false)
        setGrantableRoleNames([])
        return
      }
      const payload = await res.json()
      setCanCreate(payload.data?.canCreate === true)
      setGrantableRoleNames(payload.data?.grantableRoleNames ?? [])
    } catch {
      setCanCreate(false)
      setGrantableRoleNames([])
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      await Promise.all([fetchTeachers(), fetchCreateCapability()])
    }
    load()
  }, [fetchTeachers, fetchCreateCapability])

  const handleEdit = (teacher: Teacher) => {
    setEditId(teacher.id)
    setFormOpen(true)
  }

  const handleDelete = async (teacher: Teacher) => {
    const ok = await confirm({
      title: 'Delete Staff Member?',
      description: `This will permanently delete ${teacher.firstName} ${teacher.lastName}. This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/portal/api/teachers/${teacher.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Staff member deleted' })
        fetchTeachers()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete' })
    }
  }

  const handleFormSuccess = (result?: StaffCreateResult) => {
    setFormOpen(false)
    setEditId(null)
    // `undefined` for an edit, which creates nothing and mails nothing. A create
    // that came back undelivered leaves the fault on screen until it is dismissed.
    setDeliveryFailure(result && !result.delivered ? result : null)
    fetchTeachers()
  }

  const handleFormClose = (open: boolean) => {
    if (!open) {
      setFormOpen(false)
      setEditId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Teachers</h1>
          <p className="text-sm text-muted-foreground">Manage all teaching staff</p>
        </div>
        {/* The affordance is gated on the caller's permission, not on a role
            comparison in this file. The route is the boundary; this only keeps the
            button from inviting a request that would be refused. */}
        {canCreate && (
          <Button
            onClick={() => { setEditId(null); setFormOpen(true) }}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Staff
          </Button>
        )}
      </div>

      {/*
        Destructive styling, deliberately, and not a toast.

        The account was created. The one thing that did not happen is the message
        telling the person how to use it, so the state is "half-finished" in exactly
        the sense this feature exists to avoid — and the only way to finish it is for
        the recipient to request a password reset from the sign-in page, which needs
        an operator who knows it happened. Presenting that in the same green as a
        successful invitation would hide the fault that has to be acted on.
      */}
      {deliveryFailure && (
        <Alert variant="destructive">
          <MailWarning className="h-4 w-4" />
          <AlertTitle>Staff account created, but the setup email was not sent</AlertTitle>
          <AlertDescription>
            <p>
              <strong>{deliveryFailure.email}</strong> now has a portal login and
              appears in the list below, but the one-time link to set a password was
              never delivered &mdash; so they cannot sign in yet, and no password was
              ever created.
            </p>
            <p className="mt-2">
              Ask them to use &ldquo;Forgot password&rdquo; on the sign-in page. Do not
              create a second account: the address is already taken, and a retry will
              be refused as a duplicate.
            </p>
            <button
              type="button"
              onClick={() => setDeliveryFailure(null)}
              className="mt-2 text-sm font-medium underline"
            >
              Dismiss
            </button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Staff ({teachers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : teachers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No staff found</p>
              {/* Only offered when the button above is actually on screen. */}
              {canCreate && (
                <p className="text-sm mt-1">Click &quot;Add Staff&quot; to get started</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Name</th>
                    <th className="text-left py-2">Email</th>
                    <th className="text-left py-2">Phone</th>
                    <th className="text-left py-2">Role</th>
                    <th className="text-left py-2">Hire Date</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="py-2 font-medium">
                        {t.firstName} {t.lastName}
                        {t.employeeId && (
                          <p className="text-xs text-muted-foreground">ID: {t.employeeId}</p>
                        )}
                        {sessionEmail && t.user?.email === sessionEmail && (
                          <Link
                            href="/portal/teachers/me"
                            className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                          >
                            My Workspace
                          </Link>
                        )}
                      </td>
                      <td className="py-2 text-sm">{t.email}</td>
                      <td className="py-2 text-sm">{t.phone || '-'}</td>
                      <td className="py-2">
                        {t.role?.name ? (
                          <Badge variant="secondary">{t.role.name}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">Unassigned</span>
                        )}
                      </td>
                      <td className="py-2 text-sm text-muted-foreground">
                        {t.hireDate ? new Date(t.hireDate).toLocaleDateString() : '-'}
                      </td>
                      <td className="py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(t)}>
                              <Edit2 className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(t)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Button
        variant="ghost"
        size="sm"
        onClick={fetchTeachers}
        disabled={loading}
        className="gap-2"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        Refresh
      </Button>

      <StaffForm
        open={formOpen}
        onOpenChange={handleFormClose}
        editId={editId}
        grantableRoleNames={grantableRoleNames}
        onSuccess={handleFormSuccess}
      />
    </div>
  )
}


