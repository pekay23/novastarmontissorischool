'use client'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@novastar/shared-ui'
import { AlertTriangle, ArrowRight, Users } from 'lucide-react'
import { resolveDestination, type PromotionOverrideInput } from './promotion-plan'

export interface RosterStudent {
  id: string
  firstName: string
  lastName: string
  studentId: string | null
}

export interface ClassOption {
  id: string
  name: string
}

export interface TermOption {
  id: string
  name: string
  academicYear: { name: string }
}

const COHORT_TARGET = '__cohort__'

/**
 * The read-only roster with one destination `<Select>` per row.
 *
 * A row's `<Select>` starts on whatever `resolveDestination` says for that
 * student — the cohort target, unless the map carries an override for them.
 * That is the same function the API plans with, so the destination shown
 * before saving is the destination that will be written, rather than a
 * component-local guess that could drift from the server's rule.
 *
 * Read-only in the sense that this screen never writes: it renders what the
 * source class contains and collects destinations. It never edits student
 * records.
 */
export function PromotionRoster({
  students,
  classes,
  cohortTargetClassId,
  overrides,
  disabled,
  onOverrideChange,
}: {
  students: readonly RosterStudent[]
  classes: readonly ClassOption[]
  cohortTargetClassId: string
  /** Pre-computed by the page, so it is not rebuilt once per rendered row. */
  overrides: readonly PromotionOverrideInput[]
  disabled?: boolean
  onOverrideChange: (studentId: string, toClassId: string | null) => void
}) {
  const cohortTargetName =
    classes.find((entry) => entry.id === cohortTargetClassId)?.name ?? cohortTargetClassId

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Student</TableHead>
          <TableHead>Student ID</TableHead>
          <TableHead>Destination class</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {students.map((student) => {
          const effective = resolveDestination(
            student.id,
            cohortTargetClassId,
            overrides,
          )
          const isOverride = effective !== cohortTargetClassId

          return (
            <TableRow key={student.id}>
              <TableCell className="font-medium">
                {student.firstName} {student.lastName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {student.studentId ?? <span className="italic">not assigned</span>}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Select
                    value={effective}
                    disabled={disabled || classes.length === 0}
                    onValueChange={(value) =>
                      onOverrideChange(
                        student.id,
                        value === COHORT_TARGET || value === cohortTargetClassId ? null : value,
                      )
                    }
                  >
                    <SelectTrigger
                      aria-label={`Destination class for ${student.firstName} ${student.lastName}`}
                      className="min-w-56"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {/* The cohort destination is the default and is spelled
                          out as such, so a row that was not individually
                          changed reads as "following the class" rather than as
                          an arbitrary selection the operator has to inspect. */}
                      <SelectItem value={COHORT_TARGET}>
                        All students → {cohortTargetName}
                      </SelectItem>
                      {classes
                        .filter((entry) => entry.id !== cohortTargetClassId)
                        .map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name} only
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {isOverride && (
                    <Badge variant="secondary" className="shrink-0">
                      override
                    </Badge>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/**
 * Turn the row-keyed override map into the list shape the planner takes.
 *
 * The page keeps overrides as a map because that is what a per-row control
 * naturally produces — one key per student, absent when the row is following
 * the cohort — and an absent key must not become an override pointing at
 * nothing. An empty destination deletes the entry rather than storing `''`,
 * which the planner would then reject as an unknown class.
 */
export function toOverrideList(
  overrides: Readonly<Record<string, string>>,
): PromotionOverrideInput[] {
  return Object.entries(overrides)
    .filter(([, toClassId]) => toClassId.length > 0)
    .map(([studentId, toClassId]) => ({ studentId, toClassId }))
}

/**
 * The warning above the action.
 *
 * `role="note"` rather than a bare coloured paragraph: this is standing
 * context, not an error, and a screen reader announcing it as an alert would
 * interrupt whatever the user was doing when the page loaded. The shared-ui
 * `Alert` primitive carries `role="alert"` by default and spreads later
 * attributes over it, so the override here is deliberate and is the reason
 * the role is passed explicitly rather than assumed.
 *
 * The real enforcement is the `@@unique([tenantId, studentId, termId])`
 * constraint on `Enrollment` plus the single transaction around the whole
 * cohort: re-running a promotion converges on the same rows rather than
 * duplicating them, and a failure anywhere rolls the whole cohort back. This
 * banner is defence in depth for the human, not the mechanism.
 */
export function PromotionCaution() {
  return (
    <Alert variant="destructive" role="note">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>This moves every student in the class</AlertTitle>
      <AlertDescription>
        <p>
          Each student&rsquo;s current class is changed and the term&rsquo;s enrolment
          history is rewritten for the whole cohort at once. Any student left behind can
          be sent to a different class from this table first.
        </p>
        <p className="mt-2">
          The operation runs in a single transaction and the{' '}
          <code>Enrollment</code> unique constraint on{' '}
          <code>(tenantId, studentId, termId)</code> makes a repeated promotion converge
          on the same result instead of duplicating it, so a second press cannot
          double-enrol anyone. This notice is a reminder, not the safeguard.
        </p>
      </AlertDescription>
    </Alert>
  )
}

export function PromotionLoading() {
  return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export function PromotionHeader({
  studentCount,
  canPromote,
  ready,
  promoting,
  onPromote,
}: {
  studentCount: number
  /** Whether the caller holds `promotion:execute`, as the server reports it. */
  canPromote: boolean
  /** Whether a source class, a distinct target class and a term are chosen. */
  ready: boolean
  promoting: boolean
  onPromote: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-heading font-bold">Class Promotions</h1>
        <p className="text-sm text-muted-foreground">
          Move a class cohort to the next class for a term
        </p>
      </div>
      <Button
        className="gap-2"
        onClick={onPromote}
        // Disabled rather than hidden, and disabled for two distinct reasons
        // that read the same to the user: no permission, or nothing chosen
        // yet. `promotion:execute` is checked server-side and this flag comes
        // from the server too, so a delegated grant is honoured — but the
        // API re-checks regardless, and this is only so the operator is not
        // invited to fill in a form that can only 403.
        disabled={!canPromote || !ready || promoting}
        title={
          canPromote
            ? undefined
            : 'You do not have permission to promote a class cohort'
        }
      >
        <ArrowRight className="h-4 w-4" />
        {promoting ? 'Promoting…' : `Promote cohort${studentCount > 0 ? ` (${studentCount})` : ''}`}
      </Button>
    </div>
  )
}

export function PromotionRosterCard({
  studentCount,
  children,
}: {
  studentCount: number
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Source class roster ({studentCount})
        </CardTitle>
        <CardDescription>
          Read-only. Set a destination only for the students who should not follow the class.
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}