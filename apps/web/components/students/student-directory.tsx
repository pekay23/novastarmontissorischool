'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  useToast,
  useConfirm,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@novastar/shared-ui'
import {
  Plus,
  Search,
  User,
  MoreHorizontal,
  Edit2,
  Trash2,
  RefreshCw,
} from 'lucide-react'

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

export function StudentDirectory({
  canCreate,
  canEdit,
  canDelete,
}: {
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const confirm = useConfirm()
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()
    return students.filter((student) =>
      [
        student.firstName,
        student.lastName,
        student.otherNames,
        student.studentId,
        student.admissionNumber,
        student.class?.name,
      ].some((value) => value?.toLowerCase().includes(query)),
    )
  }, [students, search])
  const pageCount = Math.max(1, Math.ceil(filteredStudents.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleStudents = filteredStudents.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )

  const fetchStudents = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
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
    setPage(1)
  }

  const handleEdit = (student: Student) => {
    router.push(`/portal/students/${encodeURIComponent(student.id)}/edit`)
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
      const res = await fetch(`/portal/api/students/${student.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Student deleted' })
        fetchStudents()
      } else {
        const data = await res.json()
        toast.error({
          title: 'Error',
          description: data.error || 'Failed to delete student',
        })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete student' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold">Students</h1>
          <p className="text-sm text-muted-foreground">
            Manage all enrolled students
          </p>
        </div>
        {canCreate && (
          <Button asChild className="gap-2">
            <Link href="/portal/students/new">
              <Plus className="h-4 w-4" />
              Add Student
            </Link>
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          aria-label="Search students"
          placeholder="Search students..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Students ({filteredStudents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : filteredStudents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No students found</p>
              <p className="text-sm mt-1">
                Click &quot;Add Student&quot; to get started
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <caption className="sr-only">
                  Student directory, page {currentPage} of {pageCount}
                </caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="text-left py-2">
                      Name
                    </th>
                    <th className="text-left py-2">Student ID</th>
                    <th className="text-left py-2">Class</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Joined</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-2">
                        <div className="font-medium">
                          {s.firstName} {s.lastName}
                        </div>
                        {s.otherNames && (
                          <p className="text-sm text-muted-foreground">
                            {s.otherNames}
                          </p>
                        )}
                      </td>
                      <td className="py-2 text-sm">
                        {s.studentId || s.admissionNumber || '-'}
                      </td>
                      <td className="py-2">
                        {s.class?.name || (
                          <span className="text-muted-foreground">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        <Badge
                          variant={
                            s.status === 'ACTIVE' ? 'default' : 'outline'
                          }
                        >
                          {s.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-sm text-muted-foreground">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        {(canEdit || canDelete) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Actions for ${s.firstName} ${s.lastName}`}
                                className="h-8 w-8"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canEdit && (
                                <DropdownMenuItem onClick={() => handleEdit(s)}>
                                  <Edit2 className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                              )}
                              {canEdit && canDelete && (
                                <DropdownMenuSeparator />
                              )}
                              {canDelete && (
                                <DropdownMenuItem
                                  onClick={() => handleDelete(s)}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
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

      <nav
        aria-label="Student directory pages"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-muted-foreground">
          Page {currentPage} of {pageCount} · {filteredStudents.length} students
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      </nav>
    </div>
  )
}
