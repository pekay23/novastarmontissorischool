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
import { contrastTextColor, type BandStatus } from '@novastar/shared-utils'

interface ReportStudent {
  id: string
  firstName: string
  lastName: string
  studentId: string | null
  class: string | null
  classLevel: string | null
}

/**
 * A band of the school's own grading scale, resolved from the percentage.
 *
 * Coloured by the band's own `color` and never by the size of the score: bands
 * are school-configured and the seeded JHS scale runs the other way (grade 9 is
 * the worst result), so magnitude-based colouring would mislabel half the school.
 */
interface ReportBand {
  key: string
  label: string
  color: string
  minScore: number
  maxScore: number
  description?: string | null
}

/** One continuous-assessment component, as the school configured it. */
interface ReportWeightingComponent {
  code: string | null
  name: string
  count: number
  /** The relative weight each assessment of this type carried. */
  weight: number
  /** That weight as a share of the total, 0-100. */
  weightShare: number | null
  percentage: number | null
}

interface ReportWeighting {
  rule: string
  totalWeight: number
  components: ReportWeightingComponent[]
}

interface ReportSubject {
  subjectId: string
  subjectName: string
  subjectCode: string | null
  /** 0-100, weighted within the subject. Null when the weights cannot be composed. */
  percentage: number | null
  gradedAssessments: number
  band: ReportBand | null
  /**
   * Which state the band above is in, stated rather than inferred from its
   * absence: `band: null` used to mean "no scale", "below the scale", "above the
   * scale", "no bands on the scale", "in a gap in the scale" and "two bands
   * claim this" all at once, and every one of them rendered as a bare "-".
   */
  bandStatus: BandStatus
  /**
   * Set when the school's own scale cannot grade — the ranges and defects it is
   * named by. The label states which of them applies; this says what to fix.
   */
  bandProblem: string | null
  weighting: ReportWeighting
}

interface ReportAssessment {
  id: string
  name: string
  subject: string
  subjectCode: string | null
  subjectId: string | null
  assessmentType: string
  assessmentTypeCode: string | null
  /** The weight this assessment contributed under, after the type fallback. */
  weight: number
  /** Where that weight came from: the assessment, its configured type, or 1. */
  weightSource: 'assessment' | 'assessment_type' | 'default'
  maxScore: number
  score: number | null
  percentage: number | null
  /** The band key recorded when the score was graded. Audit only — see `band`. */
  grade: string | null
  band: ReportBand | null
  isGraded: boolean
  assessmentDate: string
  term: string | null
  academicYear: string | null
}

interface ReportSummary {
  totalAssessments: number
  gradedAssessments: number
  /** 0-100, weighted across every graded assessment. */
  weightedPercentage: number | null
  /** 0-100, mean of the per-subject percentages. */
  overallPercentage: number | null
  weighting: ReportWeighting
  subjectCount: number
  hasAttendanceData: boolean
  /** 0-100. */
  attendanceRate: number | null
  /** Distinct calendar days, not periods. */
  totalAttendanceDays: number
  /** Credited days, fractional: one HALF_DAY credits 0.5. */
  presentDays: number
  excusedDays: number
}

/** The school's own scale for this class, or null when none applies. */
interface ReportGrading {
  scaleId: string
  name: string
  description: string | null
  appliesToLevels: string[]
}

interface AcademicReport {
  student: ReportStudent
  grading: ReportGrading | null
  summary: ReportSummary
  subjects: ReportSubject[]
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

/**
 * Credited attendance days, without a trailing ".00".
 *
 * `presentDays` is fractional by design — one `HALF_DAY` credits 0.5 — so a
 * fixed two decimals would render a whole term as "62.00", and a bare
 * `toFixed(1)` would render 62 as "62.0". Integers lose the decimal point,
 * fractions keep one digit.
 */
const formatDays = (days: number): string =>
  Number.isInteger(days) ? String(days) : days.toFixed(1)

/**
 * What the card says in place of a band, per `bandStatus`.
 *
 * Every state gets its own words, because a single "-" said "no mark recorded" for
 * six different reasons and four of them are faults in the school's own settings
 * that nobody was shown.
 */
const BAND_STATUS_LABEL: Record<BandStatus, string> = {
  ok: '',
  'no-scale': 'No grading scale',
  'no-bands': 'Scale cannot grade',
  'below-scale': 'Below the scale',
  'above-scale': 'Above the scale',
  hole: 'Gap in the scale',
  ambiguous: 'Two bands claim this',
  'no-percentage': 'No mark to band',
}

/**
 * Whether a state is the scale's fault rather than an absence of configuration.
 *
 * Only these are drawn as an error, so a school that simply has not built a scale
 * yet is not told it is broken.
 */
const BAND_STATUS_IS_FAULT: Record<BandStatus, boolean> = {
  ok: false,
  'no-scale': false,
  'no-bands': true,
  'below-scale': true,
  'above-scale': true,
  hole: true,
  ambiguous: true,
  'no-percentage': false,
}

/**
 * A band badge in the school's own colour, with text contrast decided from that
 * colour rather than from the score.
 *
 * With no band there is still a statement to make, so this never prints a bare
 * "-" when it knows why: `status` names the state (a subject summary carries one),
 * `problem` carries the ranges to fix, and `scaleName` resolves the one state the
 * summary cannot — `no-scale` means either "no scale applies" or "the scale that
 * applies has no bands", and only this component is told which scale applied. A
 * per-assessment row passes no status, so the fallback stays "-" there unless its
 * subject's problem travels down with it.
 *
 * Exported so the card's own claims can be rendered and asserted rather than read
 * as source text: every state below is a sentence a parent is shown, and the
 * defect this fixes is that four of them used to be the same "-".
 */
export const BandBadge = ({
  band,
  status = null,
  problem = null,
  scaleName = null,
  percentage = null,
}: {
  band: ReportBand | null
  /** `BandStatus` for a subject row; null for a single assessment. */
  status?: BandStatus | null
  /** The ranges or defects the scale is at fault for, when there are any. */
  problem?: string | null
  /** The scale that applied to this class, when one did. */
  scaleName?: string | null
  /** The percentage the band was resolved from, quoted in the explanation. */
  percentage?: number | null
}) => {
  if (band) {
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{ backgroundColor: band.color, color: contrastTextColor(band.color) }}
        title={`${band.minScore}-${band.maxScore}%`}
      >
        {band.label}
      </span>
    )
  }

  if (status) {
    // A scale that applies but carries no bands is a misconfiguration, not an
    // absence of one, so it is drawn as the fault it is even though `no-scale`
    // covers both.
    const fault =
      BAND_STATUS_IS_FAULT[status] || (status === 'no-scale' && scaleName !== null)
    // The scale the school would have to fix, named so a parent reading the
    // printed card can be told what to look at.
    const detail =
      status === 'no-scale'
        ? scaleName
          ? `The scale "${scaleName}" has no bands, so no percentage can be given one.`
          : 'No grading scale applies to this class, so no band can be assigned.'
        : status === 'no-bands'
          ? 'No band on this scale can claim a percentage: each one runs backwards or falls outside 0-100.'
          : percentage !== null && problem
            ? `${percentage.toFixed(1)}% is not inside any band — ${problem}`
            : problem
    return (
      <span
        className={
          fault
            ? 'inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive'
            : 'inline-flex items-center rounded-full border border-muted-foreground/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground'
        }
        title={detail ?? BAND_STATUS_LABEL[status]}
      >
        <span className="sr-only">
          {fault ? 'Band withheld, grading scale problem: ' : 'No band: '}
        </span>
        {BAND_STATUS_LABEL[status]}
      </span>
    )
  }

  // An assessment row: it carries no status of its own, so the only honest
  // statement available is the one its subject's scale is at fault for. Printing
  // "-" there instead would read as a missing mark.
  if (problem) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive"
        title={problem}
      >
        <span className="sr-only">Band withheld, grading scale error: </span>
        Scale error
      </span>
    )
  }

  return <span className="text-muted-foreground">-</span>
}

/**
 * How a percentage was composed. A teacher who cannot see why a child got 72%
 * has no reason to believe the 72%, so the weights and their shares are on the
 * card rather than only inside the arithmetic.
 */
const WeightingBreakdown = ({
  weighting,
  caption,
}: {
  weighting: ReportWeighting
  caption: string
}) => {
  if (weighting.components.length === 0) {
    return <p className="text-xs text-muted-foreground">No graded assessments to weigh.</p>
  }
  return (
    <div className="mt-2">
      <p className="text-xs text-muted-foreground mb-1">{caption}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Component</TableHead>
            <TableHead className="text-xs text-right">Entries</TableHead>
            <TableHead className="text-xs text-right">Weight</TableHead>
            <TableHead className="text-xs text-right">Share</TableHead>
            <TableHead className="text-xs text-right">%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {weighting.components.map((component) => (
            <TableRow key={component.code ?? component.name}>
              <TableCell className="text-sm">{component.name}</TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {component.count}
              </TableCell>
              <TableCell className="text-right text-sm">{component.weight.toFixed(2)}</TableCell>
              <TableCell className="text-right text-sm">
                {component.weightShare !== null ? `${component.weightShare.toFixed(1)}%` : '-'}
              </TableCell>
              <TableCell className="text-right text-sm">
                {component.percentage !== null ? `${component.percentage.toFixed(1)}%` : '-'}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="text-sm font-medium">Total</TableCell>
            <TableCell className="text-right text-sm text-muted-foreground">
              {weighting.components.reduce((sum, c) => sum + c.count, 0)}
            </TableCell>
            <TableCell className="text-right text-sm font-medium">
              {weighting.totalWeight.toFixed(2)}
            </TableCell>
            <TableCell className="text-right text-sm font-medium">100%</TableCell>
            <TableCell className="text-right text-sm font-medium">-</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  )
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

  const { student, grading, summary, subjects, assessments } = report
  const academicYear = assessments[0]?.academicYear || null
  const term = assessments[0]?.term || null

  const groupedBySubject = assessments.reduce<Record<string, ReportAssessment[]>>((acc, a) => {
    const key = a.subject
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  // The per-subject block carries the percentage, the school's band for it and
  // how that percentage was composed. The API groups on subject *id*; the card
  // is laid out by display name, so the two are joined here.
  const subjectByName = new Map(subjects.map((s) => [s.subjectName, s]))

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

            {/* Summary. Percentage is the figure a parent reads, so it leads and
                every label names its unit and range. There is no grade-point
                average here: this school reports percentages, and the label
                under each percentage is the school's own band. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Card>
                <CardHeader>
                  <CardDescription>Overall % (0&ndash;100)</CardDescription>
                  <CardTitle className="text-3xl">
                    {summary.overallPercentage !== null
                      ? `${summary.overallPercentage.toFixed(1)}%`
                      : '-'}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Mean of {summary.subjectCount} subject average
                    {summary.subjectCount === 1 ? '' : 's'}
                  </p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Weighted % (0&ndash;100)</CardDescription>
                  <CardTitle className="text-3xl">
                    {summary.weightedPercentage !== null
                      ? `${summary.weightedPercentage.toFixed(1)}%`
                      : '-'}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Mean mark across every graded assessment
                  </p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Attendance (0&ndash;100)</CardDescription>
                  <CardTitle className="text-3xl">
                    {summary.attendanceRate !== null
                      ? `${summary.attendanceRate.toFixed(1)}%`
                      : '-'}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {formatDays(summary.presentDays)}/{summary.totalAttendanceDays} days
                    {summary.excusedDays > 0
                      ? `, ${summary.excusedDays} excused`
                      : ''}
                  </p>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader>
                  <CardDescription>Assessments graded</CardDescription>
                  <CardTitle className="text-3xl">
                    {summary.gradedAssessments}/{summary.totalAssessments}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Weighted by the school&rsquo;s assessment types
                  </p>
                </CardHeader>
              </Card>
            </div>

            {/* The school's scale, in the school's own words. Its description is
                where a school states which direction its bands run, so the card
                quotes it rather than assuming one. */}
            {grading && (
              <p className="text-xs text-muted-foreground mb-2">
                <span className="font-medium">Bands: {grading.name}</span>
                {grading.description ? ` — ${grading.description}` : ''}
              </p>
            )}

            {/* How the weighted percentage was composed. */}
            <WeightingBreakdown
              weighting={summary.weighting}
              caption="Overall mark by component"
            />

            {/* Per subject: the percentage, the school's band for it, and the
                weights behind it. */}
            <div className="space-y-6 mt-6">
              {Object.entries(groupedBySubject).map(([subjectName, subjectAssessments]) => {
                const subject = subjectByName.get(subjectName)
                return (
                  <div key={subjectName}>
                    <div className="flex flex-wrap items-baseline gap-3 mb-2">
                      <h3 className="text-lg font-semibold">{subjectName}</h3>
                      <span className="text-sm text-muted-foreground">
                        {subject?.percentage !== null && subject?.percentage !== undefined
                          ? `${subject.percentage.toFixed(1)}%`
                          : '-'}
                      </span>
                      {/* Which state the band is in is stated once, here, rather
                          than repeated on every row of the table below: it is a
                          property of the subject's bands, not of any single
                          assessment. */}
                      <BandBadge
                        band={subject?.band ?? null}
                        status={subject?.bandStatus ?? null}
                        problem={subject?.bandProblem ?? null}
                        scaleName={grading?.name ?? null}
                        percentage={subject?.percentage ?? null}
                      />
                    </div>
                    <WeightingBreakdown
                      weighting={subject?.weighting ?? summary.weighting}
                      caption="Subject mark by component"
                    />
                    <div className="overflow-x-auto mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Assessment</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Weight</TableHead>
                            <TableHead className="text-right">Max</TableHead>
                            <TableHead className="text-right">Score</TableHead>
                            <TableHead className="text-right">%</TableHead>
                            <TableHead>Band</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {subjectAssessments.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell>{a.name || a.assessmentType}</TableCell>
                              <TableCell className="text-muted-foreground">
                                {a.assessmentType}
                              </TableCell>
                              <TableCell
                                className="text-right"
                                title={
                                  a.weightSource === 'assessment'
                                    ? 'Weight set on this assessment'
                                    : a.weightSource === 'assessment_type'
                                      ? 'Weight inherited from the assessment type this school configured; retune the type to change it, and every assessment of that type without a weight of its own follows'
                                      : 'No usable weight on this assessment or on its type, so it is counted equally with the others that have none. It is not excluded, and it is not a school choice: give the assessment type a weight at Settings to change this'
                                }
                              >
                                {a.weight.toFixed(2)}
                              </TableCell>
                              <TableCell className="text-right">{a.maxScore}</TableCell>
                              <TableCell className="text-right">
                                {a.isGraded && a.score !== null ? a.score : '-'}
                              </TableCell>
                              <TableCell className="text-right">
                                {a.percentage !== null ? `${a.percentage.toFixed(1)}%` : '-'}
                              </TableCell>
                              <TableCell>
                                {/* This row's band is its own percentage's, and so
                                    is its own verdict: the subject's problem travels
                                    down only where THIS row has no band, so a row
                                    that graded keeps its label and no cell in the
                                    table reads as a missing mark. */}
                                <BandBadge
                                  band={a.band}
                                  problem={a.band === null ? subject?.bandProblem ?? null : null}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
