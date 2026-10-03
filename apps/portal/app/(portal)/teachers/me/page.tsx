'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, Badge, useToast,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@novastar/shared-ui'
import {
  GraduationCap, ClipboardCheck, CalendarDays, BookOpen, FileText,
} from 'lucide-react'

interface Course {
  classSubjectId: string
  class: { id: string; name: string; level: { name: string } }
  subject: { name: string; code: string; color: string | null }
  periodsPerWeek: number
  canTakeAttendance: boolean
}

interface CoursesApiResponse {
  data: Course[]
}

interface TermApiResponse {
  data: Array<{ id: string; name: string; isCurrent: boolean }>
}

export default function TeacherWorkspacePage() {
  const { toast } = useToast()

  const [courses, setCourses] = useState<Course[]>([])
  const [currentTermId, setCurrentTermId] = useState<string | null>(null)
  const [currentTermName, setCurrentTermName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCourses = useCallback(async () => {
    try {
      const res = await fetch('/api/teachers/me/courses')
      if (res.ok) {
        const data: CoursesApiResponse = await res.json()
        setCourses(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load courses' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load courses' })
    }
  }, [toast])

  // The current term ids the "View Timetable" and "Give Marks"
  // links, both of which are term-parameterised. A teacher who
  // can read terms always holds `term:read` (academic category);
  // a failure here only disables those two links, never the page.
  const fetchCurrentTerm = useCallback(async () => {
    try {
      const res = await fetch('/api/terms?current=true')
      if (res.ok) {
        const data: TermApiResponse = await res.json()
        const current = (data.data || []).find((t) => t.isCurrent)
        setCurrentTermId(current?.id ?? null)
        setCurrentTermName(current?.name ?? null)
      }
    } catch {
      // silently fail — the course list is the page's payload
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([fetchCourses(), fetchCurrentTerm()])
      setLoading(false)
    }
    load()
  }, [fetchCourses, fetchCurrentTerm])

  const attendanceHref = (classId: string) => `/attendance?class=${classId}`
  const timetableHref = (classId: string) =>
    currentTermId ? `/timetable?class=${classId}&term=${currentTermId}` : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-heading font-bold">My Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Your courses and the actions on them
          {currentTermName ? ` • ${currentTermName}` : ''}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Courses ({courses.length})</CardTitle>
          <CardDescription>
            Subjects you teach, with attendance marking and the class timetable
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : courses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <GraduationCap className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No courses assigned to you</p>
              <p className="text-sm mt-1">
                Your courses appear here once a subject is assigned to you in a class.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead className="text-right">Periods / week</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.map((course) => {
                    const timetableLink = timetableHref(course.class.id)
                    return (
                      <TableRow key={course.classSubjectId}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {course.subject.color ? (
                              <span
                                aria-hidden="true"
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: course.subject.color }}
                              />
                            ) : null}
                            {course.subject.name}
                            {course.subject.code ? (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {course.subject.code}
                              </span>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{course.class.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{course.class.level.name}</Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {course.periodsPerWeek}
                        </TableCell>
                        <TableCell>
                          {/* Inline action group (the endorsed
                              btn-group pattern): one small outline
                              button per existing feature. Nothing
                              here is a permanently-disabled menu
                              item — every action is either live or
                              disabled with its reason. */}
                          <div className="flex flex-wrap items-center gap-2">
                            {course.canTakeAttendance ? (
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                                aria-label={`Take attendance for ${course.class.name}`}
                              >
                                <Link href={attendanceHref(course.class.id)}>
                                  <ClipboardCheck className="h-4 w-4" />
                                  Take Attendance
                                </Link>
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled
                                title="You are not assigned to mark attendance for this class"
                                aria-label={`Take attendance for ${course.class.name} — you are not assigned to mark attendance for this class`}
                              >
                                <ClipboardCheck className="h-4 w-4" />
                                Take Attendance
                              </Button>
                            )}

                            {timetableLink ? (
                              <Button
                                variant="outline"
                                size="sm"
                                asChild
                                aria-label={`View timetable for ${course.class.name}`}
                              >
                                <Link href={timetableLink}>
                                  <CalendarDays className="h-4 w-4" />
                                  View Timetable
                                </Link>
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled
                                title="No current term is set, so the timetable cannot be opened for a term"
                                aria-label={`View timetable for ${course.class.name} — no current term is set`}
                              >
                                <CalendarDays className="h-4 w-4" />
                                View Timetable
                              </Button>
                            )}

                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              aria-label={`Give marks — opens Grades, which lists assessments for every class`}
                            >
                              {/* Unparameterised on purpose. `/api/assessments`
                                  does filter by `?classId=&termId=`, but the
                                  Grades page builds its own query with only
                                  `search`, so it never forwards either — a
                                  `?classSubject=`-style href would land on
                                  Grades showing every assessment and look
                                  filtered. Score entry is then reached through
                                  `/grades/<assessmentId>/scores`, which is keyed
                                  by assessment, not by course, so there is no
                                  per-course target to link to until the page
                                  accepts a course filter. */}
                              <Link href="/grades">
                                <BookOpen className="h-4 w-4" />
                                Give Marks
                              </Link>
                            </Button>

                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              aria-label="View results"
                            >
                              <Link href="/reports">
                                <FileText className="h-4 w-4" />
                                View Results
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
