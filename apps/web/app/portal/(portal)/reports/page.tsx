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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@novastar/shared-ui'
import { ReportType } from '@novastar/database'
import { type BandStatus } from '@novastar/shared-utils'
import { BandBadge, type ReportBand } from '@/components/reports/band-badge'
import { BarChart3, Download, X, Printer } from 'lucide-react'

const REPORT_TYPE_LABELS: Record<ReportType, { label: string; desc: string; implemented: boolean }> = {
  ACADEMIC_REPORT: { label: 'Academic Report', desc: 'Student academic performance report card', implemented: true },
  TRANSCRIPT: { label: 'Transcript', desc: 'Official student transcript', implemented: false },
  FEE_STATEMENT: { label: 'Fee Statement', desc: 'Student fee invoice and payment history', implemented: false },
  ATTENDANCE_REPORT: { label: 'Attendance Report', desc: 'Student attendance summary', implemented: false },
  STAFF_PERFORMANCE: { label: 'Staff Performance', desc: 'Teacher/staff performance review', implemented: false },
  FINANCIAL_SUMMARY: { label: 'Financial Summary', desc: 'School finances overview', implemented: false },
  ENROLLMENT_STATS: { label: 'Enrollment Statistics', desc: 'Student enrollment by class/year', implemented: false },
  CUSTOM: { label: 'Custom Report', desc: 'User-defined custom report', implemented: false },
}

/**
 * Only these types have a backing generator. The rest are declared in
 * `REPORT_TYPE_LABELS` for display but deliberately excluded from the
 * Generate selector: previously every type silently hit the academic
 * route, so choosing "Fee Statement" returned an academic report card.
 */
const IMPLEMENTED_REPORT_TYPES = (Object.keys(REPORT_TYPE_LABELS) as ReportType[]).filter(
  (type) => REPORT_TYPE_LABELS[type].implemented,
)

/**
 * Credited attendance days, without a trailing ".00".
 *
 * `presentDays` is fractional by design — one `HALF_DAY` credits 0.5 — so two
 * fixed decimals would render a whole term as "62.00" and one decimal would
 * render 62 as "62.0". Integers drop the decimal point; fractions keep one.
 */
const formatDays = (days: number): string =>
  Number.isInteger(days) ? String(days) : days.toFixed(1)

interface StudentOption {
  id: string
  firstName: string
  lastName: string
  studentId: string
}

interface ReportSummary {
  totalAssessments: number
  gradedAssessments: number
  /** 0-100, weighted across every graded assessment. */
  weightedPercentage: number | null
  /** 0-100, mean of the per-subject percentages. */
  overallPercentage: number | null
  /** How the weighted mean was composed, by assessment type. */
  weighting: ReportWeighting
  subjectCount: number
  attendanceRate: number | null
  totalAttendanceDays: number
  /** Credited days, fractional: one HALF_DAY credits 0.5. */
  presentDays: number
  excusedDays: number
}

/** One continuous-assessment component, as the school configured it. */
interface ReportWeightingComponent {
  code: string | null
  name: string
  count: number
  weight: number
  weightShare: number | null
  percentage: number | null
}

interface ReportWeighting {
  rule: string
  totalWeight: number
  components: ReportWeightingComponent[]
}

interface ReportAssessment {
  id: string
  name: string
  subject: string
  subjectCode: string | null
  subjectId: string | null
  assessmentType: string
  weight: number
  maxScore: number
  score: number | null
  percentage: number | null
  grade: string | null
  band: ReportBand | null
  /**
   * This row's own verdict on its band, and the ranges to fix when it has none.
   *
   * Declared because this page reads the same `/api/reports/academic/[studentId]`
   * payload as the report card and both are only honest if they read the same
   * fields. The list previously typed neither, so it fell back to a bare "-" for
   * every state the card can name.
   */
  bandStatus: BandStatus
  bandProblem: string | null
  isGraded: boolean
  assessmentDate: string
  term: string | null
  academicYear: string | null
}

interface ReportStudent {
  id: string
  firstName: string
  lastName: string
  studentId: string | null
  class: string | null
  classLevel: string | null
}

/** The school's own scale for this class, or null when none applies. */
interface ReportGrading {
  scaleId: string
  name: string
  description: string | null
  appliesToLevels: string[]
}

interface ReportData {
  student: ReportStudent
  grading: ReportGrading | null
  summary: ReportSummary
  assessments: ReportAssessment[]
}

export default function ReportsPage() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; type?: string }>
  >([])
  const [students, setStudents] = useState<StudentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState('')
  const [selectedReportType, setSelectedReportType] =
    useState<ReportType>('ACADEMIC_REPORT')
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [templatesRes, studentsRes] = await Promise.all([
        fetch('/api/report-templates'),
        fetch('/api/students'),
      ])

      if (templatesRes.ok) {
        const data = await templatesRes.json()
        setTemplates(data.data || [])
      }
      if (studentsRes.ok) {
        const data = await studentsRes.json()
        setStudents(data.data || [])
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load report data' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const load = async () => {
      await fetchData()
    }
    load()
  }, [fetchData])

  const handleGenerateReport = async () => {
    if (!selectedStudent) {
      toast.error({ title: 'Error', description: 'Please select a student' })
      return
    }

    if (!REPORT_TYPE_LABELS[selectedReportType].implemented) {
      toast.error({
        title: 'Not available',
        description: `${REPORT_TYPE_LABELS[selectedReportType].label} generation is not implemented yet`,
      })
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/reports/academic/${selectedStudent}`)
      if (res.ok) {
        const data: ReportData = await res.json()
        setReportData(data)
        setReportDialogOpen(true)
        toast.success({
          title: 'Success',
          description: 'Report generated successfully',
        })
      } else {
        const data = await res.json()
        toast.error({
          title: 'Error',
          description: data.error || 'Failed to generate report',
        })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to generate report' })
    } finally {
      setLoading(false)
    }
  }

  const handlePrintReport = () => {
    window.print()
  }

  const handleDownloadPdf = () => {
    toast.info({
      title: 'Coming Soon',
      description: 'PDF download will be available in a future update',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">
            Generate academic reports, fee statements, and analytics
          </p>
        </div>
      </div>

      {/* Quick Generate */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Academic Report</CardTitle>
          <CardDescription>
            Select a student to generate their report card
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="student-select">Student</Label>
              <Select value={selectedStudent} onValueChange={setSelectedStudent}>
                <SelectTrigger id="student-select">
                  <SelectValue placeholder="Select a student" />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.firstName} {s.lastName} ({s.studentId})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="report-type">Report Type</Label>
              <Select
                value={selectedReportType}
                onValueChange={(v) => setSelectedReportType(v as ReportType)}
              >
                <SelectTrigger id="report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPLEMENTED_REPORT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {REPORT_TYPE_LABELS[type].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleGenerateReport}
                className="w-full gap-2"
                disabled={loading || !selectedStudent}
              >
                <BarChart3 className="h-4 w-4" />
                Generate
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configured Templates */}
      <Card>
        <CardHeader>
          <CardTitle>Configured Report Templates</CardTitle>
          <CardDescription>
            Pre-built templates configured by your school administrator
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <p className="text-muted-foreground">
              No report templates configured for your school. Configure
              templates in Settings.
            </p>
          ) : (
            <div className="space-y-3">
              {templates.map((t) => {
                const info =
                  REPORT_TYPE_LABELS[
                    (t.type as ReportType) ?? 'ACADEMIC_REPORT'
                  ] || REPORT_TYPE_LABELS.ACADEMIC_REPORT
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {info.desc}
                      </p>
                    </div>
                    <Button variant="outline" size="sm">
                      Generate
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Types */}
      <Card>
        <CardHeader>
          <CardTitle>Available Report Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {Object.entries(REPORT_TYPE_LABELS).map(([type, info]) => (
              <div
                key={type}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-xs">
                    {info.label}
                  </Badge>
                  <div>
                    <p className="font-medium">{info.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {info.desc}
                    </p>
                  </div>
                </div>
                <Badge variant={info.implemented ? 'default' : 'secondary'}>
                  {info.implemented ? 'Available' : 'Not implemented'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Report Card Viewer Dialog */}
      <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Academic Report Card</DialogTitle>
            <DialogDescription>
              Generated for{' '}
{reportData
                  ? `${reportData.student.firstName} ${reportData.student.lastName}`
                  : 'No student selected'}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto max-h-[calc(90vh-120px)]">
            {reportData && (
              <div className="space-y-6">
                {/* Header */}
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-bold">
                    {reportData.student.firstName}{' '}
                    {reportData.student.lastName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Student ID: {reportData.student.studentId || 'N/A'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Class: {reportData.student.classLevel || 'N/A'}{' '}
                    {reportData.student.class || ''}
                  </p>
                </div>

                {/* Summary. Percentage leads: it is the unit primary and JHS
                     report in, and every label names its range. The grade-point
                     average this used to show is gone with the column it read. */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Summary</CardTitle>
                    {reportData.grading && (
                      <CardDescription>
                        Bands: {reportData.grading.name}
                        {reportData.grading.description
                          ? ` — ${reportData.grading.description}`
                          : ''}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                      <div>
                        <p className="text-3xl font-bold">
{reportData.summary.overallPercentage !== null
                  ? `${reportData.summary.overallPercentage}%`
                  : 'No marks recorded'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Overall % (0&ndash;100)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          mean of {reportData.summary.subjectCount} subject
                          average
                          {reportData.summary.subjectCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div>
                        <p className="text-3xl font-bold">
{reportData.summary.weightedPercentage !== null
                  ? `${reportData.summary.weightedPercentage}%`
                  : 'No marks recorded'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Weighted % (0&ndash;100)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          mean mark, weighted
                        </p>
                      </div>
                      <div>
                        <p className="text-3xl font-bold">
{reportData.summary.attendanceRate !== null
                  ? `${reportData.summary.attendanceRate}%`
                  : 'No attendance data'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Attendance (0&ndash;100)
                        </p>
                      </div>
                      <div>
                        <p className="text-3xl font-bold">
                          {reportData.summary.gradedAssessments}
                          /{reportData.summary.totalAssessments}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Assessments graded
                        </p>
                      </div>
                    </div>

                    {/* The weights behind the weighted figure, so the number can
                        be checked rather than believed. */}
                    {reportData.summary.weighting.components.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-muted-foreground mb-1">
                          Overall mark by component
                        </p>
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-1">Component</th>
                              <th className="text-right py-1">Entries</th>
                              <th className="text-right py-1">Weight</th>
                              <th className="text-right py-1">Share</th>
                              <th className="text-right py-1">%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportData.summary.weighting.components.map((component) => (
                              <tr key={component.code ?? component.name} className="border-t">
                                <td className="py-1">{component.name}</td>
                                <td className="py-1 text-right text-muted-foreground">
                                  {component.count}
                                </td>
                                <td className="py-1 text-right">{component.weight.toFixed(2)}</td>
                                <td className="py-1 text-right">
{component.weightShare !== null
                                ? `${component.weightShare}%`
                                : 'No share'}
                                </td>
                                <td className="py-1 text-right">
{component.percentage !== null
                                ? `${component.percentage}%`
                                : 'Not recorded'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Assessment Table */}
                <div>
                  <h3 className="font-medium mb-2">Assessment Details</h3>
                  {reportData.assessments.length === 0 ? (
                    <p className="text-muted-foreground">
                      No assessment data available.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2">Subject</th>
                            <th className="text-left py-2">Assessment</th>
                            <th className="text-left py-2">Type</th>
                            <th className="text-right py-2">Max</th>
                            <th className="text-right py-2">Score</th>
                            <th className="text-right py-2">%</th>
                            <th className="text-center py-2">Grade</th>
                            <th className="text-left py-2">Term</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.assessments.map((a) => (
                            <tr key={a.id} className="border-t">
                              <td className="py-2">
                                {a.subject}
                                {a.subjectCode && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    ({a.subjectCode})
                                  </span>
                                )}
                              </td>
                              <td className="py-2">{a.name}</td>
                              <td className="py-2 text-muted-foreground">
                                {a.assessmentType}
                              </td>
                              <td className="py-2 text-right">{a.maxScore}</td>
                              <td className="py-2 text-right">
                                {a.score ?? 'Not marked'}
                              </td>
                              <td className="py-2 text-right">
                                {/* A 0 is a mark, not an absence: the old truthiness
                                    test printed a dash for a child who scored zero,
                                    which reads as "nothing recorded". */}
                                {a.percentage !== null ? `${a.percentage}%` : 'Not marked'}
                              </td>
                              <td className="py-2 text-center">
                                <BandBadge
                                  band={a.band}
                                  status={a.bandStatus}
                                  problem={a.bandProblem}
                                  scaleName={reportData.grading?.name ?? null}
                                  percentage={a.percentage}
                                />
                              </td>
                              <td className="py-2 text-muted-foreground">
                                {a.term ?? 'No term'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Attendance Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      Attendance Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-xl font-bold">
                          {reportData.summary.totalAttendanceDays}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Days Recorded
                        </p>
                      </div>
                      <div>
                        <p className="text-xl font-bold">
                          {formatDays(reportData.summary.presentDays)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Days Credited
                        </p>
                      </div>
                      <div>
                        <p className="text-xl font-bold">
{reportData.summary.attendanceRate !== null
                  ? `${reportData.summary.attendanceRate}%`
                  : 'No attendance data'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Rate
                        </p>
                      </div>
                    </div>
                    {reportData.summary.excusedDays > 0 && (
                      <p className="mt-3 text-xs text-muted-foreground text-center">
                        {reportData.summary.excusedDays} day
                        {reportData.summary.excusedDays === 1 ? '' : 's'} excused
                        and excluded from the rate.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReportDialogOpen(false)}
            >
              <X className="h-4 w-4 mr-2" />
              Close
            </Button>
            <Button variant="outline" onClick={handlePrintReport}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
            <Button onClick={handleDownloadPdf}>
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
