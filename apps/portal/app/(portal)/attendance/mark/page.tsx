'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, useToast, useConfirm,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Input,
} from '@novastar/shared-ui'
import { Search, Save, Calendar, MoreHorizontal, Clock } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

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
  const { toast } = useToast()
  const confirm = useConfirm()

  const [classId, setClassId] = useState<string>('')
  const [className, setClassName] = useState<string>('')
  const [date, setDate] = useState<string>('')
  const [period, setPeriod] = useState<string>('')
  const [students, setStudents] = useState<Student[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

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
      const attendanceData = students.map(student => {
        const existing = records.find(r => r.studentId === student.id)
        return {
          studentId: student.id,
          classId,
          date,
          period: period || undefined,
          status: existing?.status || 'PRESENT',
          notes: existing?.notes || undefined,
        }
      })

      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attendanceData),
      })

      if (res.ok) {
        toast.success({ title: 'Success', description: 'Attendance saved successfully' })
        // Refresh records
        await fetchExistingAttendance(classId, date, period)
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to save attendance' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save attendance' })
    } finally {
      setSaving(false)
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
    }
  })

  const filteredStudents = mergedStudents.filter(s =>
    `${s.firstName} ${s.lastName} ${s.studentId || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const ready = Boolean(classId && date)

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
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleDelete({
                                    id: student.recordId!,
                                    studentId: student.id,
                                    student: { id: student.id, firstName: student.firstName, lastName: student.lastName, studentId: student.studentId },
                                    status: student.status,
                                    period: student.period,
                                    notes: student.notes,
                                    markedBy: null,
                                    createdAt: new Date().toISOString(),
                                  })}
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
    </div>
  )
}
