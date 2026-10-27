'use client'

import { useState, useEffect } from 'react'
import {
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
import { AmendmentReasonField } from '@/components/config/amendment-reason-field'
import {
  isLockedRecord,
  isUsableReason,
  MISSING_REASON_MESSAGE,
} from '@/components/config/amendment'

interface ClassOption {
  id: string
  name: string
}

interface StudentFormProps {
  editId?: string | null
  onCancel: () => void
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

export function StudentForm({ editId, onCancel, onSuccess }: StudentFormProps) {
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
  const [loading, setLoading] = useState(Boolean(editId))
  const isEditing = Boolean(editId)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initialData, setInitialData] = useState<Record<
    string,
    unknown
  > | null>(null)
  const [amendmentReason, setAmendmentReason] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/portal/api/classes', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load class options')
        const payload = await response.json()
        setClasses(payload.data ?? [])
      })
      .catch(() => {
        if (!controller.signal.aborted) setClasses([])
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!editId) return
    const controller = new AbortController()
    fetch(`/portal/api/students/${encodeURIComponent(editId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load this student')
        const student = await response.json()
        if (controller.signal.aborted) return
        setInitialData(student)
        setForm({
          studentId: student.studentId ?? '',
          firstName: student.firstName ?? '',
          lastName: student.lastName ?? '',
          otherNames: student.otherNames ?? '',
          dateOfBirth: student.dateOfBirth?.slice(0, 10) ?? '',
          gender: student.gender ?? '',
          admissionNumber: student.admissionNumber ?? '',
          classId: student.classId ?? '',
        })
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError(
            'Unable to load this student. Return to the list and try again.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [editId])

  const handleChange = (field: keyof StudentForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loadError) return
    if (isLockedRecord(initialData) && !isUsableReason(amendmentReason)) {
      toast.error({
        title: 'Reason required',
        description: MISSING_REASON_MESSAGE,
      })
      return
    }
    // `POST /api/students` requires gender and PATCH accepts it, so an unset
    // control has to be refused here rather than sent and bounced by the server.
    if (
      form.gender !== 'MALE' &&
      form.gender !== 'FEMALE' &&
      form.gender !== 'OTHER'
    ) {
      toast.error({ title: 'Error', description: 'Please select a gender.' })
      return
    }
    setLoading(true)
    try {
      const body = {
        ...(isLockedRecord(initialData) ? { amendmentReason } : {}),
        studentId: form.studentId,
        firstName: form.firstName,
        lastName: form.lastName,
        otherNames: form.otherNames || undefined,
        gender: form.gender,
        dateOfBirth: form.dateOfBirth,
        admissionNumber: form.admissionNumber || undefined,
        classId: form.classId || (isEditing ? null : undefined),
      }

      const url = isEditing
        ? `/portal/api/students/${encodeURIComponent(editId ?? '')}`
        : '/portal/api/students'
      const method = isEditing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success({
          title: 'Success',
          description: isEditing
            ? 'Student updated successfully'
            : 'Student created successfully',
        })
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

  const content = (
    <form onSubmit={handleSubmit}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {isEditing ? 'Edit student' : 'Add student'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter the student's details and class assignment.
        </p>
      </header>
      {loadError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {loadError}
        </p>
      )}

      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="studentId">Student ID *</Label>
            <Input
              id="studentId"
              value={form.studentId}
              onChange={(e) => handleChange('studentId', e.target.value)}
              placeholder="e.g. STU-001"
              required
            />
          </div>
          <div>
            <Label htmlFor="admissionNumber">Admission #</Label>
            <Input
              id="admissionNumber"
              value={form.admissionNumber}
              onChange={(e) => handleChange('admissionNumber', e.target.value)}
              placeholder="Leave blank to auto-generate"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">First Name *</Label>
            <Input
              id="firstName"
              value={form.firstName}
              onChange={(e) => handleChange('firstName', e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="lastName">Last Name *</Label>
            <Input
              id="lastName"
              value={form.lastName}
              onChange={(e) => handleChange('lastName', e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <Label htmlFor="otherNames">Other Names</Label>
          <Input
            id="otherNames"
            value={form.otherNames}
            onChange={(e) => handleChange('otherNames', e.target.value)}
            placeholder="Middle name(s)"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="dateOfBirth">Date of Birth *</Label>
            <Input
              id="dateOfBirth"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => handleChange('dateOfBirth', e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="gender">Gender *</Label>
            <Select
              value={form.gender || undefined}
              onValueChange={(v) => handleChange('gender', v)}
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
            <Select
              value={form.classId || 'unassigned'}
              onValueChange={(v) =>
                handleChange('classId', v === 'unassigned' ? '' : v)
              }
            >
              <SelectTrigger id="classId">
                <SelectValue placeholder="Select a class" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <AmendmentReasonField
        key={editId ?? 'new'}
        recordId={editId ?? null}
        entityType="student"
        recordName="student"
        initialData={initialData}
        readOnly={false}
        onReasonChange={setAmendmentReason}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button type="submit" disabled={loading || Boolean(loadError)}>
          {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
          {!loading && <Check className="h-4 w-4 ml-2" />}
        </Button>
      </div>
    </form>
  )
  return (
    <div className="max-w-3xl rounded-lg border bg-card p-4 sm:p-6">
      {content}
    </div>
  )
}
