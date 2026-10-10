'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@novastar/shared-ui'
import { Check, X } from 'lucide-react'

interface ClassOption {
  id: string
  name: string
}

interface StudentFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editId?: string | null
  onSuccess: () => void
}

interface StudentForm {
  studentId: string
  firstName: string
  lastName: string
  otherNames: string
  dateOfBirth: string
  gender: Gender | ''
  admissionNumber: string
  classId: string
}

/** The `Gender` enum from `packages/database/prisma/schema.prisma`. */
type Gender = 'MALE' | 'FEMALE' | 'OTHER'

export function StudentForm({ open, onOpenChange, editId, onSuccess }: StudentFormProps) {
  const { toast } = useToast()
  const [form, setForm] = useState<StudentForm>({
    studentId: '',
    firstName: '',
    lastName: '',
    otherNames: '',
    dateOfBirth: '',
    gender: '',
    admissionNumber: '',
    classId: '',
  })
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [loading, setLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  // Fetch classes when dialog opens
  useEffect(() => {
    if (open) {
      const loadClasses = async () => {
        const res = await fetch('/api/classes')
        const data = res.ok ? await res.json() : { data: [] }
        setClasses(data.data || [])
      }
      loadClasses()
    }
  }, [open])

  // Fetch existing student data when editing
  useEffect(() => {
    const load = async () => {
      if (open && editId) {
        setIsEditing(true)
        setLoading(true)
        const res = await fetch(`/api/students/${editId}`)
        const student = res.ok ? await res.json() : null
        if (student) {
          setForm({
            studentId: student.studentId || '',
            firstName: student.firstName || '',
            lastName: student.lastName || '',
            otherNames: student.otherNames || '',
            dateOfBirth: student.dateOfBirth ? new Date(student.dateOfBirth).toISOString().split('T')[0] : '',
            gender: student.gender || '',
            admissionNumber: student.admissionNumber || '',
            classId: student.classId || '',
          })
        }
        setLoading(false)
      } else if (open && !editId) {
        setIsEditing(false)
        setForm({
          studentId: '',
          firstName: '',
          lastName: '',
          otherNames: '',
          dateOfBirth: '',
          gender: '',
          admissionNumber: '',
          classId: '',
        })
      }
    }
    if (open) load()
  }, [open, editId])

  const handleChange = (field: keyof StudentForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // `POST /api/students` requires gender and PATCH accepts it, so an unset
    // control has to be refused here rather than sent and bounced by the server.
    if (form.gender !== 'MALE' && form.gender !== 'FEMALE' && form.gender !== 'OTHER') {
      toast.error({ title: 'Error', description: 'Please select a gender.' })
      return
    }
    setLoading(true)
    try {
      const body = {
        studentId: form.studentId,
        firstName: form.firstName,
        lastName: form.lastName,
        otherNames: form.otherNames || undefined,
        gender: form.gender,
        dateOfBirth: form.dateOfBirth,
        admissionNumber: form.admissionNumber || undefined,
        classId: form.classId || undefined,
      }

      const url = isEditing ? `/api/students/${editId}` : '/api/students'
      const method = isEditing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success({
          title: 'Success',
          description: isEditing ? 'Student updated successfully' : 'Student created successfully',
        })
        onOpenChange(false)
        onSuccess()
      } else {
        const data = await res.json()
        toast.error({
          title: 'Error',
          description: data.error || 'Failed to save student',
        })
      }
    } catch {
      toast.error({
        title: 'Error',
        description: 'Failed to save student',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Student' : 'Add New Student'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update student information' : 'Enter student details to create a new record'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="studentId">Student ID *</Label>
                <Input
                  id="studentId"
                  value={form.studentId}
                  onChange={e => handleChange('studentId', e.target.value)}
                  placeholder="e.g. STU-001"
                  required
                />
              </div>
              <div>
                <Label htmlFor="admissionNumber">Admission #</Label>
                <Input
                  id="admissionNumber"
                  value={form.admissionNumber}
                  onChange={e => handleChange('admissionNumber', e.target.value)}
                  placeholder="Leave blank to auto-generate"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={e => handleChange('firstName', e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={e => handleChange('lastName', e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="otherNames">Other Names</Label>
              <Input
                id="otherNames"
                value={form.otherNames}
                onChange={e => handleChange('otherNames', e.target.value)}
                placeholder="Middle name(s)"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="dateOfBirth">Date of Birth *</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={e => handleChange('dateOfBirth', e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="gender">Gender *</Label>
                <Select
                  value={form.gender || undefined}
                  onValueChange={v => handleChange('gender', v)}
                >
                  <SelectTrigger id="gender">
                    <SelectValue placeholder="Select a gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="classId">Class</Label>
                <Select value={form.classId || undefined} onValueChange={v => handleChange('classId', v)}>
                  <SelectTrigger id="classId">
                    <SelectValue placeholder="Select a class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Unassigned</SelectItem>
                    {classes.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
              {!loading && <Check className="h-4 w-4 ml-2" />}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
