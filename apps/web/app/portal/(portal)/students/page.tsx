'use client'

import { useState, useEffect } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, Button, Badge,
  useToast, useConfirm,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@novastar/shared-ui'
import { Plus, Search, User, MoreHorizontal, Edit2, Trash2, RefreshCw } from 'lucide-react'
import { StudentForm } from '@/components/students/student-form'

interface Student {
  id: string
  studentId: string
  firstName: string
  lastName: string
  otherNames: string | null
  admissionNumber: string
  status: string
  class: { name: string } | null
  createdAt: string
}

export default function StudentsPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const fetchStudents = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/portal/api/students?${params}`)
      if (res.ok) {
        const data = await res.json()
        setStudents(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load students' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load students' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      await fetchStudents()
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (value: string) => {
    setSearch(value)
    if (value.length >= 2 || value.length === 0) {
      fetchStudents()
    }
  }

  const handleEdit = (student: Student) => {
    setEditId(student.id)
    setFormOpen(true)
  }

  const handleDelete = async (student: Student) => {
    const ok = await confirm({
      title: 'Delete Student?',
      description: `This will permanently delete ${student.firstName} ${student.lastName}. This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/portal/api/students/${student.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Student deleted' })
        fetchStudents()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete student' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete student' })
    }
  }

  const handleFormSuccess = () => {
    setFormOpen(false)
    setEditId(null)
    fetchStudents()
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
          <h1 className="text-3xl font-heading font-bold">Students</h1>
          <p className="text-sm text-muted-foreground">Manage all enrolled students</p>
        </div>
        <Button onClick={() => { setEditId(null); setFormOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Student
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search students..."
          value={search}
          onChange={e => handleSearch(e.target.value)}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Students ({students.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No students found</p>
              <p className="text-sm mt-1">Click &quot;Add Student&quot; to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Name</th>
                    <th className="text-left py-2">Student ID</th>
                    <th className="text-left py-2">Class</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Joined</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-2">
                        <div className="font-medium">
                          {s.firstName} {s.lastName}
                        </div>
                        {s.otherNames && (
                          <p className="text-sm text-muted-foreground">{s.otherNames}</p>
                        )}
                      </td>
                      <td className="py-2 text-sm">{s.studentId || s.admissionNumber || '-'}</td>
                      <td className="py-2">{s.class?.name || <span className="text-muted-foreground">Unassigned</span>}</td>
                      <td className="py-2">
                        <Badge variant={s.status === 'ACTIVE' ? 'default' : 'outline'}>
                          {s.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-sm text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(s)}>
                              <Edit2 className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(s)}
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
        onClick={fetchStudents}
        disabled={loading}
        className="gap-2"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        Refresh
      </Button>

      <StudentForm
        open={formOpen}
        onOpenChange={handleFormClose}
        editId={editId}
        onSuccess={handleFormSuccess}
      />
    </div>
  )
}
