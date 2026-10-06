'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, useToast, useConfirm,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Input, Textarea, Badge, Label,
} from '@novastar/shared-ui'
import { Search, Save, Calendar, MoreHorizontal, Clock, Lock, History } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { AttendanceAmendmentHistory } from '@/components/attendance/amendment-history'
import {
  REASON_MAX_LENGTH,
  attendanceCorrectionBody,
  canUnlockAttendance,
  changedAttendanceFields,
  isSettledRecord,
  settledColumnsOf,
  type AttendanceFieldPatch,
} from '@/components/attendance/correction'

interface Student {
  id: string
  firstName: string
  lastName: string
  studentId: string | null
}

interface AttendanceRecord {
  id: string
  studentId: string
  student: Student
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY'
  period: string | null
  notes: string | null
  markedBy: { name: string } | null
  createdAt: string
  /** The reason-gated lock. Non-null means this record has been settled. */
  finalizedAt?: string | null
  finalizedById?: string | null
}

const statusColors: Record<string, string> = {
  PRESENT: 'bg-green-100 text-green-800',
  ABSENT: 'bg-red-100 text-red-800',
  LATE: 'bg-amber-100 text-amber-800',
  EXCUSED: 'bg-blue-100 text-blue-800',
  HALF_DAY: 'bg-purple-100 text-purple-800',
}

/**
 * The marking screen. Reached only with `?class=<id>&date=<YYYY-MM-DD>`
 * (and optionally `&period=`) from the class picker or a teacher's
 * course list — there is no route parameter, so a bare visit to
 * `/attendance/mark` says so instead of rendering an empty roster.
 */
export default function AttendanceMarkPage() {
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const { toast } = useToast()
  const confirm = useConfirm()

  // The unlock is a stricter act than the correction it enables, so the button
  // that offers it is gated on the stricter key. The route re-checks with
  // `hasPermission`, so this is the courtesy layer, not the boundary.
  const role = (session?.user as { role?: string })?.role
  const mayUnlock = canUnlockAttendance(role)

  const [classId, setClassId] = useState<string>('')
  const [className, setClassName] = useState<string>('')
  const [date, setDate] = useState<string>('')
  const [period, setPeriod] = useState<string>('')
  const [students, setStudents] = useState<Student[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  // The reason owed by a correction to a SETTLED record. One box for the screen,
  // because a teacher correcting four registers writes one explanation about
  // four marks, not four near-identical sentences.
  const [reason, setReason] = useState('')
  const [historyRecord, setHistoryRecord] = useState<{ recordId: string; studentName: string } | null>(null)

  const fetchStudentsForClass = useCallback(async (cid: string) => {
    try {
      const res = await fetch(`/api/classes/${cid}`)
      if (res.ok) {
        const data = await res.json()
        // The class itself carries the name the header shows.
        setClassName(data.name || '')
        const studentsWithIds = (data.students || []).map((s: { id: string; firstName: string; lastName: string; studentId: string | null }) => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          studentId: s.studentId,
        }))
        setStudents(studentsWithIds)
      }
    } catch {
      // silently fail
    }
  }, [])

  const fetchExistingAttendance = useCallback(async (cid: string, attendanceDate: string, periodFilter?: string) => {
    try {
      const params = new URLSearchParams()
      params.set('classId', cid)
      params.set('date', attendanceDate)
      if (periodFilter) params.set('period', periodFilter)
      const res = await fetch(`/api/attendance?${params}`)
      if (res.ok) {
        const data = await res.json()
        setRecords(data.data || [])
      }
    } catch {
      // silently fail
    }
  }, [])

  // Parse params from URL
  useEffect(() => {
    const init = async () => {
      // Extract classId and date from URL search params
      const urlClassId = searchParams.get('class')
      const urlDate = searchParams.get('date')
      const urlPeriod = searchParams.get('period')

      if (urlClassId) setClassId(urlClassId)
      if (urlDate) setDate(urlDate)
      if (urlPeriod) setPeriod(urlPeriod)

      if (urlClassId && urlDate) {
        await fetchStudentsForClass(urlClassId)
        await fetchExistingAttendance(urlClassId, urlDate, urlPeriod || undefined)
      }
      setLoading(false)
    }
    init()
  }, [searchParams, fetchStudentsForClass, fetchExistingAttendance])

  /**
   * Upsert the in-progress state for one rostered student.
   *
   * The roster — not the previously saved records — is the
   * source of truth. A student with no saved record has no
   * entry in `records`, and `Array.prototype.map` only visits
   * existing entries, so a plain `map` made every per-student
   * edit (and "mark all ABSENT") a no-op for unmarked
   * students: an unmarked student could not be marked ABSENT
   * without first saving a PRESENT row. Upserting by student
   * id means the first edit to an unmarked student creates the
   * entry, defaulting to the same all-present the table shows.
   */
  const upsertRecord = useCallback((studentId: string, patch: Partial<AttendanceRecord>) => {
    setRecords(prev => {
      const index = prev.findIndex(r => r.studentId === studentId)
      if (index === -1) {
        const student = students.find(s => s.id === studentId)
        if (!student) return prev
        return [
          ...prev,
          {
            id: '',
            studentId,
            student,
            status: 'PRESENT',
            period: '',
            notes: '',
            markedBy: null,
            createdAt: new Date().toISOString(),
            ...patch,
          },
        ]
      }
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }, [students])

  const handleMarkAll = (status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY') => {
    // The whole roster, not just already-saved rows — an
    // unmarked student must be writable too.
    for (const student of students) {
      upsertRecord(student.id, { status, period: period || '' })
    }
  }

  const handleMarkAllFromCheckbox = (checked: boolean) => {
    handleMarkAll(checked ? 'PRESENT' : 'ABSENT')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // A settled register is corrected INDIVIDUALLY and with a reason; it is
      // not part of the bulk re-save. `POST /api/attendance` refuses a locked
      // row by design — marking a class is not correcting a disputed record —
      // so the two go down separate paths here rather than the screen silently
      // dropping the corrections it cannot express.
      const settled: Array<{ record: AttendanceRecord; fields: AttendanceFieldPatch[] }> = []
      const markable = students.map(student => {
        const existing = records.find(r => r.studentId === student.id)
        if (!existing) {
          return {
            studentId: student.id,
            classId,
            date,
            period: period || undefined,
            status: 'PRESENT' as const,
            notes: undefined,
          }
        }
        if (isSettledRecord(existing)) {
          const fields = changedAttendanceFields(existing, {
            status: existing.status,
            period: existing.period ?? '',
            notes: existing.notes ?? '',
          })
          if (fields.length > 0) settled.push({ record: existing, fields })
          return null
        }
        return {
          studentId: student.id,
          classId,
          date,
          period: period || undefined,
          status: existing.status,
          notes: existing.notes || undefined,
        }
      })

      if (settled.length > 0 && reason.trim() === '') {
        toast.error({
          title: 'A reason is required',
          description:
            'These records have already been settled. Describe what is being corrected and why — the reason is recorded against each field you change.',
        })
        return
      }

      const failures: string[] = []

      if (markable.length > 0) {
        const res = await fetch('/api/attendance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(markable),
        })
        if (!res.ok) {
          const data = await res.json()
          toast.error({ title: 'Error', description: data.error || 'Failed to save attendance' })
        } else {
          const payload = await res.json()
          // A 201 with a per-record error inside it is the bulk save reporting
          // that one register could not be written. Reading only `res.ok` would
          // have reported success while the refused rows were silently missing.
          const problems = (payload?.results ?? []).filter(
            (r: { error?: string }) => typeof r?.error === 'string',
          )
          for (const problem of problems) failures.push(problem.error)
        }
        await fetchExistingAttendance(classId, date, period)
      }

      for (const { record, fields } of settled) {
        const values: Partial<Record<AttendanceFieldPatch, string | null>> = {}
        for (const field of fields) {
          if (field === 'status') values.status = record.status
          if (field === 'period') values.period = record.period ?? ''
          if (field === 'notes') values.notes = record.notes ?? ''
        }
        const res = await fetch(`/api/attendance/${record.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attendanceCorrectionBody(record, fields, values, reason)),
        })
        if (!res.ok) {
          const data = await res.json()
          const detail = Array.isArray(data?.details) ? data.details.join(' ') : data?.error
          failures.push(
            `${record.student.firstName} ${record.student.lastName}: ${detail || 'correction refused'}`,
          )
        }
      }

      if (settled.length > 0) await fetchExistingAttendance(classId, date, period)

      if (failures.length > 0) {
        toast.error({ title: 'Some rows were not saved', description: failures.join(' · ') })
      } else {
        toast.success({ title: 'Success', description: 'Attendance saved successfully' })
        setReason('')
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save attendance' })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Lifting the lock, which is a stricter act than the correction it enables and
   * carries its own written reason.
   */
  const handleUnlock = async (record: AttendanceRecord) => {
    if (reason.trim() === '') {
      toast.error({
        title: 'A reason is required',
        description: 'Reopening a settled record has to say why, and the reason is recorded.',
      })
      return
    }
    const ok = await confirm({
      title: 'Reopen this record?',
      description: `The settled date will be removed and the reason recorded against the change. Anyone with attendance:edit will be able to correct the record without a reason afterwards.`,
      confirmText: 'Reopen',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/attendance/${record.id}/unfinalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amendmentReason: reason.trim() }),
      })
      if (res.ok) {
        toast.success({ title: 'Reopened', description: 'The record is editable again' })
        setReason('')
        await fetchExistingAttendance(classId, date, period)
      } else {
        const data = await res.json()
        const detail = Array.isArray(data?.details) ? data.details.join(' ') : data?.error
        toast.error({ title: 'Could not reopen', description: detail || 'Failed to unlock record' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to unlock record' })
    }
  }

  const handleDelete = async (record: AttendanceRecord) => {
    const ok = await confirm({
      title: 'Delete Attendance Record?',
      description: `Remove attendance record for ${record.student.firstName} ${record.student.lastName}?`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/attendance/${record.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Record deleted' })
        setRecords(prev => prev.filter(r => r.id !== record.id))
      } else {
        toast.error({ title: 'Error', description: 'Failed to delete record' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete record' })
    }
  }

  interface MergedStudent extends Student {
    status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY'
    period: string
    notes: string
    recordId: string | null
    /** The saved row behind this line, or null for a student not yet marked. */
    record: AttendanceRecord | null
    /** Whether this line has been settled and therefore needs a written reason. */
    locked: boolean
  }

  // Merge students with their attendance records
  const mergedStudents: MergedStudent[] = students.map(student => {
    const record = records.find(r => r.studentId === student.id)
    return {
      ...student,
      status: record?.status || 'PRESENT',
      period: record?.period ?? '',
      notes: record?.notes ?? '',
      recordId: record?.id ?? null,
      record: record ?? null,
      locked: isSettledRecord(record),
    }
  })

  const filteredStudents = mergedStudents.filter(s =>
    `${s.firstName} ${s.lastName} ${s.studentId || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const ready = Boolean(classId && date)

  /**
   * Whether the screen currently owes a reason.
   *
   * True when a settled line has a pending edit, or when a settled line exists
   * at all and the caller has typed something — the second half is what makes the
   * unlock button's reason requirement discoverable BEFORE the click, rather than
   * after a refused request.
   */
  const settledCount = mergedStudents.filter(s => s.locked).length
  const reasonOwed = settledCount > 0

  if (loading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/attendance">&larr; Back to Attendance</Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/attendance">&larr; Back to Attendance</Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleMarkAll('PRESENT')}
            disabled={saving || students.length === 0}
          >
            Mark All Present
          </Button>
          <Button className="gap-2" onClick={handleSave} disabled={saving || students.length === 0}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Attendance'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Mark Attendance
          </CardTitle>
          <CardDescription>
            Class: {className || classId || '—'} • Date: {date ? new Date(date).toLocaleDateString() : '—'}{period && ` • Period: ${period}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!ready ? (
            <p className="text-sm text-muted-foreground">
              Choose a class from the attendance overview to mark attendance for a date.
            </p>
          ) : (
            <>
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search students..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 pr-4 py-2 border rounded-md w-full max-w-xs"
                  aria-label="Search students"
                />
              </div>

              {/* One reason for the screen, shown only when a settled record is on
                  it. It is owed by a CORRECTION to a settled record and by the
                  unlock alike, and both record it against every field the edit
                  changed. */}
              {reasonOwed && (
                <div className="mb-4 rounded-md border p-3 space-y-1">
                  <Label className="flex items-center gap-2 font-medium">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                    Reason for the {settledCount} settled record{settledCount === 1 ? '' : 's'}
                  </Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={REASON_MAX_LENGTH}
                    placeholder="Describe what is being corrected and why…"
                    aria-label="Reason for correcting a settled attendance record"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required to change a settled record, and recorded against each field you change.
                  </p>
                </div>
              )}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <input
                          type="checkbox"
                          checked={filteredStudents.every(s => s.status === 'PRESENT') && filteredStudents.length > 0}
                          onChange={(e) => handleMarkAllFromCheckbox(e.target.checked)}
                          className="rounded"
                          aria-label="Select all students as present"
                        />
                      </TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Student ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStudents.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={student.status === 'PRESENT'}
                            onChange={(e) => {
                              const newStatus = e.target.checked ? 'PRESENT' : 'ABSENT'
                              upsertRecord(student.id, { status: newStatus })
                            }}
                            className="rounded"
                            aria-label={`Mark ${student.firstName} ${student.lastName} present`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {student.firstName} {student.lastName}
                          {/* The settled marker sits beside the name because it changes
                              what the row MEANS: the fields below are still editable,
                              but every change to them is a correction with a written
                              reason rather than a mark. */}
                          {student.locked && (
                            <Badge variant="outline" className="ml-2 gap-1">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              Settled
                            </Badge>
                          )}
                          {/* WHEN it was settled, not just that it was: "settled"
                              without a date cannot be weighed against a correction
                              the reader is about to make. */}
                          {settledColumnsOf(student.record).finalizedAt && (
                            <time
                              className="ml-2 text-xs text-muted-foreground"
                              dateTime={settledColumnsOf(student.record).finalizedAt ?? undefined}
                            >
                              {new Date(settledColumnsOf(student.record).finalizedAt!).toLocaleDateString()}
                            </time>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {student.studentId || '-'}
                        </TableCell>
                        <TableCell>
                          <select
                            value={student.status}
                            onChange={(e) => {
                              upsertRecord(student.id, { status: e.target.value as 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'HALF_DAY' })
                            }}
                            className={`w-full px-2 py-1 border rounded ${statusColors[student.status]}`}
                            aria-label={`Status for ${student.firstName} ${student.lastName}`}
                          >
                            <option value="PRESENT">Present</option>
                            <option value="ABSENT">Absent</option>
                            <option value="LATE">Late</option>
                            <option value="EXCUSED">Excused</option>
                            <option value="HALF_DAY">Half Day</option>
                          </select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={student.period}
                            onChange={(e) => {
                              upsertRecord(student.id, { period: e.target.value })
                            }}
                            placeholder="Period"
                            aria-label={`Period for ${student.firstName} ${student.lastName}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={student.notes}
                            onChange={(e) => {
                              upsertRecord(student.id, { notes: e.target.value })
                            }}
                            placeholder="Notes"
                            aria-label={`Notes for ${student.firstName} ${student.lastName}`}
                          />
                        </TableCell>
                        <TableCell>
                          {student.recordId && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">
                                    Actions for {student.firstName} {student.lastName}
                                  </span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => setHistoryRecord({
                                    recordId: student.recordId!,
                                    studentName: `${student.firstName} ${student.lastName}`,
                                  })}
                                >
                                  <History className="h-4 w-4 mr-2" aria-hidden="true" />
                                  Amendment history
                                </DropdownMenuItem>
                                {/* Offered only to a caller who may delete the register
                                    outright, which is the same authority the route
                                    re-checks. Hidden rather than disabled so the screen
                                    does not advertise an act this caller cannot
                                    perform. */}
                                {student.locked && mayUnlock && (
                                  <DropdownMenuItem onClick={() => handleUnlock(student.record!)}>
                                    <Lock className="h-4 w-4 mr-2" aria-hidden="true" />
                                    Reopen with a reason
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  onClick={() => handleDelete(student.record!)}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {filteredStudents.length === 0 && students.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No students found for this class</p>
                </div>
              )}

              {filteredStudents.length === 0 && students.length > 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No students match your search</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* The trail for one register entry. Opened from the row menu, and keyed on
          the record id so switching students re-reads rather than showing the
          previous student's history. */}
      {historyRecord && (
        <AttendanceAmendmentHistory
          open
          onClose={() => setHistoryRecord(null)}
          recordId={historyRecord.recordId}
          studentName={historyRecord.studentName}
          markedByName={
            records.find(r => r.id === historyRecord.recordId)?.markedBy?.name ?? null
          }
          markedAt={
            records.find(r => r.id === historyRecord.recordId)?.createdAt ?? null
          }
        />
      )}
    </div>
  )
}
