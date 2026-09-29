'use client'

import { useState, useEffect } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, Button, Badge,
  useToast, useConfirm,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@novastar/shared-ui'
import { Plus, Users, MoreHorizontal, Edit2, Trash2, RefreshCw } from 'lucide-react'
import { StaffForm } from '@/components/teachers/staff-form'

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
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const fetchTeachers = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/teachers')
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
  }

  useEffect(() => {
    const load = async () => {
      await fetchTeachers()
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      const res = await fetch(`/api/teachers/${teacher.id}`, { method: 'DELETE' })
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

  const handleFormSuccess = () => {
    setFormOpen(false)
    setEditId(null)
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
        <Button onClick={() => { setEditId(null); setFormOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Staff
        </Button>
      </div>

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
              <p className="text-sm mt-1">Click &quot;Add Staff&quot; to get started</p>
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
        onSuccess={handleFormSuccess}
      />
    </div>
  )
}
