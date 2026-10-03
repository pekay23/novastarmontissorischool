'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, Badge, useToast,
  Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  Separator,
} from '@novastar/shared-ui'
import {
  Download, Printer,
} from 'lucide-react'
import Link from 'next/link'

interface ReportStudent {
  id: string
  firstName: string
  lastName: string
  studentId: string | null
  class: string | null
  classLevel: string | null
}

interface ReportAssessment {
  id: string
  name: string
  subject: string
  subjectCode: string | null
  assessmentType: string
  weight: number
  maxScore: number
  score: number | null
  percentage: number | null
  grade: string | null
  isGraded: boolean
  assessmentDate: string
  term: string | null
  academicYear: string | null
}

interface ReportSummary {
  totalAssessments: number
  gradedAssessments: number
  gpa: number | null
  overallPercentage: number | null
  hasAttendanceData: boolean
  attendanceRate: number | null
  totalAttendanceDays: number
  presentDays: number
}

interface AcademicReport {
  student: ReportStudent
  summary: ReportSummary
  assessments: ReportAssessment[]
}

/** One row of `/api/enrollments` — the terms a student was enrolled in. */
interface ReportEnrollment {
  termId: string
  term: {
    id: string
    name: string
    academicYear: { name: string } | null
  } | null
}

const gradeColors: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  F: 'bg-red-100 text-red-800',
}

const gradeBadgeClass = (grade: string | null): string => {
  if (!grade) return ''
  const upper = grade.toUpperCase()
  return gradeColors[upper] || 'bg-gray-100 text-gray-800'
}

export default function ReportCardPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { toast } = useToast()
  const [studentId, setStudentId] = useState<string | null>(null)
  const [report, setReport] = useState<AcademicReport | null>(null)
  const [loading, setLoading] = useState(true)
  // Real term selector. 'current' is the implicit default view; any
  // other value is sent to the API as `termId`, and the API resolves
  // the class and attendance for that term via the student's enrollment.
  const [selectedTerm, setSelectedTerm] = useState<string>('current')
  const [termOptions, setTermOptions] = useState<Array<{ id: string; label: string }>>([])

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params
      setStudentId(resolved.studentId)
    }
    getParams()
  }, [params])

  // Populate the selector from the student's enrollments — the terms
  // they were actually assigned to a class in.
  useEffect(() => {
    if (!studentId) return
    const loadTerms = async () => {
      try {
        const res = await fetch(`/api/enrollments?studentId=${encodeURIComponent(studentId)}`)
        if (!res.ok) return
        const data = await res.json()
        const enrollments: ReportEnrollment[] = data.data || []
        setTermOptions(
          enrollments
            .filter((e) => e.term)
            .map((e) => ({
              id: e.term!.id,
              label: `${e.term!.academicYear?.name ?? '—'} — ${e.term!.name}`,
            })),
        )
      } catch {
        // The selector stays on the default view; the report fetch
        // reports its own errors.
      }
    }
    loadTerms()
  }, [studentId])

  const fetchReport = useCallback(async (sid: string, termFilter: string) => {
    setLoading(true)
    try {
      const params: string[] = []
      if (termFilter !== 'current') {
        params.push(`termId=${encodeURIComponent(termFilter)}`)
      }
      const qs = params.length ? `?${params.join('&')}` : ''
      const res = await fetch(`/api/reports/academic/${sid}${qs}`)
      if (res.ok) {
        const data = await res.json()
        setReport(data)
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to load report' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load report' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!studentId) return
    const load = async () => {
      await fetchReport(studentId, selectedTerm)
    }
    load()
  }, [studentId, selectedTerm, fetchReport])

  const handlePrint = () => {
    window.print()
  }

  const handleExportPdf = () => {
    window.print()
  }

  if (loading || !studentId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/reports">&larr; Back to Reports</Link>
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-6 bg-muted animate-pulse rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/reports">&larr; Back to Reports</Link>
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Report not found.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { student, summary, assessments } = report
  const academicYear = assessments[0]?.academicYear || null
  const term = assessments[0]?.term || null

  const groupedBySubject = assessments.reduce<Record<string, ReportAssessment[]>>((acc, a) => {
    const key = a.subject
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  return (
    <>
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
      `}</style>
      <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reports">&larr; Back to Reports</Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {/* Term selector: picks which enrollment's term the report covers */}
          <Select value={selectedTerm} onValueChange={setSelectedTerm}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select term" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current term</SelectItem>
              {termOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportPdf}>
            <Download className="h-4 w-4 mr-2" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

        <Card className="print:shadow-none print:border">
          <CardContent className="pt-6">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-xl font-bold">Novastar Montessori School</h2>
                <p className="text-sm text-muted-foreground">Kumasi, Ghana</p>
              </div>
              <Badge variant="outline">Academic Report Card</Badge>
            </div>

            {/* Student Info */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <Label className="text-xs text-muted-foreground">Student Name</Label>
                <p className="text-lg font-medium">
                  {student.firstName} {student.lastName}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Student ID</Label>
                <p className="text-lg font-medium">{student.studentId || '-'}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Class</Label>
                <p className="text-lg font-medium">
                  {student.classLevel ? `${student.classLevel} ${student.class}` : student.class || '-'}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Academic Year / Term</Label>
                <p className="text-lg font-medium">
                  {academicYear && term
                    ? `${academicYear} — ${term}`
                    : '-'}
                </p>
              </div>
            </div>

            <Separator className="my-4" />

            {/* Summary / GPA / Attendance */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader>
                  <CardDescription>GPA</CardDescription>
                  <CardTitle className="text-2xl">
                    {summary.gpa !== null ? summary.gpa.toFixed(2) : '-'}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Overall %</CardDescription>
                  <CardTitle className="text-2xl">
                    {summary.overallPercentage !== null
                      ? `${summary.overallPercentage.toFixed(1)}%`
                      : '-'}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Attendance</CardDescription>
                  <CardTitle className="text-2xl">
                    {summary.attendanceRate !== null
                      ? `${summary.attendanceRate.toFixed(1)}%`
                      : '-'}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {summary.presentDays}/{summary.totalAttendanceDays} days
                  </p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Assessments</CardDescription>
                  <CardTitle className="text-2xl">
                    {summary.gradedAssessments}/{summary.totalAssessments}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Assessments Table — grouped by subject */}
            <div className="space-y-6">
              {Object.entries(groupedBySubject).map(([subjectName, subjectAssessments]) => (
                <div key={subjectName}>
                  <h3 className="text-lg font-semibold mb-2">{subjectName}</h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Assessment</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Weight</TableHead>
                          <TableHead className="text-right">Max</TableHead>
                          <TableHead className="text-right">Score</TableHead>
                          <TableHead className="text-right">%</TableHead>
                          <TableHead>Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {subjectAssessments.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell>{a.name || a.assessmentType}</TableCell>
                            <TableCell className="text-muted-foreground">{a.assessmentType}</TableCell>
                            <TableCell className="text-right">{a.weight.toFixed(1)}</TableCell>
                            <TableCell className="text-right">{a.maxScore}</TableCell>
                            <TableCell className="text-right">
                              {a.isGraded && a.score !== null ? a.score : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              {a.percentage !== null ? `${a.percentage.toFixed(1)}%` : '-'}
                            </TableCell>
                            <TableCell>
                              {a.grade ? (
                                <Badge className={gradeBadgeClass(a.grade)}>
                                  {a.grade}
                                </Badge>
                              ) : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
