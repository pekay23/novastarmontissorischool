'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
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
  useConfirm,
  useToast,
} from '@novastar/shared-ui'
import {
  PromotionCaution,
  PromotionHeader,
  PromotionLoading,
  PromotionRoster,
  PromotionRosterCard,
  toOverrideList,
  type ClassOption,
  type RosterStudent,
  type TermOption,
} from './promotion-roster'

/**
 * Class promotion.
 *
 * A read-only roster of the source class with a per-row destination. The
 * per-row `<Select>` is the genuinely good part of the source screen — one
 * child repeating a year, or moving to a different stream, must not hold up
 * the other forty-four — so it is kept, defaulting to the single cohort
 * target.
 *
 * Data fetching follows the house pattern (`useState` / `useCallback` /
 * `useEffect`, plain `fetch`). React Query is configured for this app but
 * deliberately unused by the other portal pages, and introducing it here
 * alone would mean one page with two different caching models.
 */
export default function PromotionsPage() {
  const { toast } = useToast()
  const confirm = useConfirm()

  const [classes, setClasses] = useState<ClassOption[]>([])
  const [terms, setTerms] = useState<TermOption[]>([])
  const [students, setStudents] = useState<RosterStudent[]>([])
  const [canPromote, setCanPromote] = useState(false)

  const [fromClassId, setFromClassId] = useState('')
  const [toClassId, setToClassId] = useState('')
  const [termId, setTermId] = useState('')
  /** Student id → destination, for rows not following the cohort. */
  const [overrides, setOverrides] = useState<Record<string, string>>({})

  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState(false)
  const [rosterLoaded, setRosterLoaded] = useState(false)

  const overrideList = useMemo(() => toOverrideList(overrides), [overrides])

  /**
   * The lookups the screen cannot start without. `canPromote` comes from the
   * server rather than from the caller's role: permissions can arrive by
   * delegation, so a role check here would disable the button for someone a
   * Head of School had explicitly granted it to.
   */
  const fetchLookups = useCallback(async () => {
    try {
      const [classRes, termRes, capabilityRes] = await Promise.all([
        fetch('/api/classes'),
        fetch('/api/terms'),
        fetch('/api/promotions'),
      ])

      if (classRes.ok) {
        const payload = await classRes.json()
        setClasses(payload.data ?? [])
      }
      if (termRes.ok) {
        const payload = await termRes.json()
        setTerms(payload.data ?? [])
      }
      if (capabilityRes.ok) {
        const payload = await capabilityRes.json()
        setCanPromote(payload.data?.canPromote === true)
      } else {
        // Fail closed. If the capability cannot be read, the action stays
        // disabled rather than inviting a request that will 403.
        setCanPromote(false)
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load classes and terms' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const fetchRoster = useCallback(async (classId: string) => {
    setRosterLoaded(false)
    setStudents([])
    if (!classId) return

    try {
      const res = await fetch(`/api/classes/${classId}`)
      if (!res.ok) {
        toast.error({ title: 'Error', description: 'Failed to load the class roster' })
        return
      }
      const payload = await res.json()
      setStudents(
        (payload.students ?? []).map(
          (student: RosterStudent) => ({
            id: student.id,
            firstName: student.firstName,
            lastName: student.lastName,
            studentId: student.studentId ?? null,
          }),
        ),
      )
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load the class roster' })
    } finally {
      setRosterLoaded(true)
    }
  }, [toast])

  useEffect(() => {
    const load = async () => {
      await fetchLookups()
    }
    void load()
  }, [fetchLookups])

  /**
   * Changing the source class reloads the roster and drops every override.
   *
   * Overrides are keyed by student id and validated against the source
   * class, so keeping them across a source-class change would send overrides
   * for students who are no longer in the cohort — which the API refuses, by
   * design. Clearing them is the only state that can succeed.
   */
  useEffect(() => {
    const load = async () => {
      setOverrides({})
      await fetchRoster(fromClassId)
    }
    void load()
  }, [fromClassId, fetchRoster])

  const setOverride = (studentId: string, destination: string | null) => {
    setOverrides((current) => {
      const next = { ...current }
      if (destination === null) delete next[studentId]
      else next[studentId] = destination
      return next
    })
  }

  const canSubmit =
    canPromote && fromClassId !== '' && toClassId !== '' && termId !== '' && students.length > 0

  const handlePromote = async () => {
    if (!canSubmit) return

    const overrideCount = overrideList.length
    const ok = await confirm({
      title: `Promote ${students.length} student${students.length === 1 ? '' : 's'}?`,
      description:
        `Everyone in this class moves to ${
          classes.find((entry) => entry.id === toClassId)?.name ?? 'the target class'
        } for ${
          terms.find((term) => term.id === termId)?.name ?? 'the selected term'
        }.` +
        (overrideCount > 0
          ? ` ${overrideCount} student${overrideCount === 1 ? '' : 's'} will go elsewhere.`
          : ''),
      confirmText: 'Promote cohort',
      variant: 'destructive',
    })
    if (!ok) return

    setPromoting(true)
    try {
      const res = await fetch('/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromClassId,
          toClassId,
          termId,
          overrides: overrideList,
        }),
      })

      const payload = await res.json().catch(() => null)

      if (!res.ok) {
        toast.error({
          title: res.status === 403 ? 'Not permitted' : 'Promotion failed',
          description:
            payload?.error ?? 'The cohort was not changed. No student was moved.',
        })
        return
      }

      const promoted: number = payload?.data?.promoted ?? 0
      const failures = payload?.data?.failures ?? []
      toast.success({
        title: 'Cohort promoted',
        description:
          failures.length > 0
            ? `${promoted} promoted, ${failures.length} failed.`
            : `${promoted} student${promoted === 1 ? '' : 's'} moved.`,
      })

      // The roster on screen is now stale: everyone shown has just moved.
      setOverrides({})
      void fetchRoster(fromClassId)
    } catch {
      toast.error({
        title: 'Promotion failed',
        description: 'The cohort was not changed. No student was moved.',
      })
    } finally {
      setPromoting(false)
    }
  }

  if (loading) return <PromotionLoading />

  // The target list cannot contain the source class. Not a nicety: the API
  // refuses `toClassId === fromClassId`, so offering the option would be
  // offering a guaranteed failure.
  const targetClasses = classes.filter((entry) => entry.id !== fromClassId)

  return (
    <div className="space-y-6 p-6">
      <PromotionHeader
        studentCount={students.length}
        canPromote={canPromote}
        ready={canSubmit}
        promoting={promoting}
        onPromote={handlePromote}
      />

      <PromotionCaution />

      <Card>
        <CardHeader>
          <CardTitle>Cohort</CardTitle>
          <CardDescription>
            Choose the class being promoted, where it goes, and for which term.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <label
              className="text-sm font-medium leading-none"
              htmlFor="promotion-from-class"
            >
              From class
            </label>
            <Select
              value={fromClassId}
              onValueChange={(value) => {
                setFromClassId(value)
                setToClassId('')
              }}
            >
              <SelectTrigger id="promotion-from-class">
                <SelectValue placeholder="Select the source class" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none" htmlFor="promotion-to-class">
              To class
            </label>
            <Select value={toClassId} onValueChange={setToClassId} disabled={!fromClassId}>
              <SelectTrigger id="promotion-to-class">
                <SelectValue placeholder="Select the target class" />
              </SelectTrigger>
              <SelectContent>
                {/* The source class is deliberately absent rather than
                    disabled: a visible-but-unselectable row reads as a bug,
                    and the API rejects the request outright anyway. */}
                {targetClasses.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium leading-none" htmlFor="promotion-term">
              Term
            </label>
            <Select value={termId} onValueChange={setTermId}>
              <SelectTrigger id="promotion-term">
                <SelectValue placeholder="Select the term" />
              </SelectTrigger>
              <SelectContent>
                {terms.map((term) => (
                  <SelectItem key={term.id} value={term.id}>
                    {term.name} · {term.academicYear.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {fromClassId === '' ? (
        <p className="text-sm text-muted-foreground">
          Select a source class to see who is in it.
        </p>
      ) : !rosterLoaded ? (
        <p className="text-sm text-muted-foreground">Loading roster…</p>
      ) : students.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          That class has no students. Promotion would move nobody.
        </p>
      ) : (
        <PromotionRosterCard studentCount={students.length}>
          <PromotionRoster
            students={students}
            classes={classes}
            cohortTargetClassId={toClassId}
            overrides={overrideList}
            disabled={promoting || toClassId === ''}
            onOverrideChange={setOverride}
          />
        </PromotionRosterCard>
      )}

      {!canSubmit && (
        <p role="note" className="text-sm text-muted-foreground">
          {!canPromote
            ? 'You do not have permission to promote a class cohort.'
            : fromClassId === ''
              ? 'Choose a source class, a target class and a term to enable the action.'
              : students.length === 0
                ? 'The source class is empty, so there is nobody to promote.'
                : 'Choose a target class and a term to enable the action.'}
        </p>
      )}
    </div>
  )
}