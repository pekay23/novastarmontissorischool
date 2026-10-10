'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  useToast,
  useConfirm,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@novastar/shared-ui'
import { Plus, Search, MoreHorizontal, Trash2, Save, X, Users } from 'lucide-react'

interface StudentOption {
  id: string
  firstName: string
  lastName: string
  studentId: string
  admissionNumber: string
}

interface ClassOption {
  id: string
  name: string
  level: { name: string }
  stream: string | null
}

interface TermOption {
  id: string
  name: string
  academicYear: { name: string }
  isCurrent: boolean
}

interface Enrollment {
  id: string
  student: {
    id: string
    firstName: string
    lastName: string
    studentId: string
    admissionNumber: string
  }
  class: {
    name: string
    level: { name: string }
  }
  term: {
    name: string
    academicYear: { name: string }
  }
  isActive: boolean
  enrolledAt: string
}

export default function EnrollmentPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState<StudentOption[]>([])
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [terms, setTerms] = useState<TermOption[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    studentId: '',
    classId: '',
    termId: '',
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)

      const [enrRes, stuRes, clsRes, trmRes] = await Promise.all([
        fetch(`/portal/api/enrollments?${params}`),
        fetch('/portal/api/students'),
        fetch('/portal/api/classes'),
        fetch('/portal/api/terms?current=true'),
      ])

      if (enrRes.ok) {
        const data = await enrRes.json()
        setEnrollments(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load enrollments' })
      }

      if (stuRes.ok) {
        const data = await stuRes.json()
        setStudents(data.data || [])
      }

      if (clsRes.ok) {
        const data = await clsRes.json()
        setClasses(data.data || [])
      }

      if (trmRes.ok) {
        const data = await trmRes.json()
        setTerms(data.data || [])
        if (data.data && data.data.length > 0) {
          setForm((f) => ({ ...f, termId: data.data.find((t: TermOption) => t.isCurrent)?.id || data.data[0]?.id || '' }))
        }
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load data' })
    } finally {
      setLoading(false)
    }
  }, [search, toast])

  useEffect(() => {
    const load = async () => {
      await fetchData()
    }
    load()
  }, [fetchData])

  const handleNew = () => {
    setForm({
      studentId: '',
      classId: '',
      termId: terms.find((t) => t.isCurrent)?.id || terms[0]?.id || '',
    })
    setDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.studentId || !form.classId || !form.termId) {
      toast.error({ title: 'Error', description: 'Please fill in all fields' })
      return
    }

    try {
      const res = await fetch('/portal/api/enrollments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (res.ok) {
        toast.success({ title: 'Success', description: 'Student enrolled successfully' })
        setDialogOpen(false)
        setForm({ studentId: '', classId: '', termId: '' })
        void fetchData()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to enroll student' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to enroll student' })
    }
  }

  const handleDelete = async (enrollment: Enrollment) => {
    const ok = await confirm({
      title: 'Remove Enrollment?',
      description: `Remove ${enrollment.student.firstName} ${enrollment.student.lastName} from ${enrollment.class.name}?`,
      confirmText: 'Remove',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/portal/api/enrollments/${enrollment.id}`, { method: 'DELETE' })
      if (res.ok) {
        const data = await res.json()
        toast.success({ title: 'Success', description: data.message || 'Enrollment removed' })
        void fetchData()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to remove enrollment' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to remove enrollment' })
    }
  }

  // Students already enrolled in the selected term (to disable them in the dropdown)
  const enrolledStudentIds = new Set(
    enrollments
      .filter((e) => e.term.name === (terms.find((t) => t.id === form.termId)?.name || ''))
      .map((e) => e.student.id),
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Student Enrollment</h1>
          <p className="text-sm text-muted-foreground">
            Manage which students are enrolled in which classes for each term
          </p>
        </div>
        <Button className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" />
          New Enrollment
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search enrollments..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Enrollments ({enrollments.length})</CardTitle>
          <CardDescription>
            Students enrolled in classes for the active term
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : enrollments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No enrollments found</p>
              <p className="text-sm mt-1">Click &quot;New Enrollment&quot; to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Student</th>
                    <th className="text-left py-2">Student ID</th>
                    <th className="text-left py-2">Class</th>
                    <th className="text-left py-2">Term</th>
                    <th className="text-left py-2">Status</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((e) => (
                    <tr key={e.id} className="border-t">
                      <td className="py-2">
                        <div className="font-medium">
                          {e.student.firstName} {e.student.lastName}
                        </div>
                      </td>
                      <td className="py-2 text-sm text-muted-foreground">
                        {e.student.studentId || e.student.admissionNumber}
                      </td>
                      <td className="py-2">
                        {e.class.level.name} {e.class.name}
                      </td>
                      <td className="py-2">
                        {e.term.academicYear.name} — {e.term.name}
                      </td>
                      <td className="py-2">
                        <Badge variant={e.isActive ? 'default' : 'outline'}>
                          {e.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleDelete(e)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Enrollment</DialogTitle>
            <DialogDescription>
              Enroll a student in a class for the selected term
            </DialogDescription>
          </DialogHeader>

          <form id="enrollment-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="studentId">Student *</Label>
              <Select
                value={form.studentId}
                onValueChange={(v) => setForm({ ...form, studentId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem
                      key={s.id}
                      value={s.id}
                      disabled={enrolledStudentIds.has(s.id)}
                    >
                      {s.firstName} {s.lastName} ({s.studentId || s.admissionNumber})
                      {enrolledStudentIds.has(s.id) && ' — already enrolled'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="classId">Class *</Label>
              <Select
                value={form.classId}
                onValueChange={(v) => setForm({ ...form, classId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a class" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.level.name} {c.name}
                      {c.stream && ` — ${c.stream}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="termId">Term *</Label>
              <Select
                value={form.termId}
                onValueChange={(v) => setForm({ ...form, termId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a term" />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.academicYear.name} — {t.name}
                      {t.isCurrent && ' (Current)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" form="enrollment-form">
              <Save className="h-4 w-4 mr-2" />
              Enroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
