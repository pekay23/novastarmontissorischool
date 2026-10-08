'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@novastar/shared-ui'
import { ChevronDown, ChevronRight, History, Loader2 } from 'lucide-react'
import { groupAmendments, type AmendmentGroup } from '../config/amendment'

/**
 * Who changed what, when and why, for ONE attendance record.
 *
 * ## WHY THIS IS NOT `components/config/amendment-history.tsx`
 *
 * That dialog renders a three-column table with "Was" and "Became" visible the
 * moment it opens. For a settings row that is fine — there are few of them and a
 * reader is looking for one field. An attendance register is the opposite: a
 * Head of School opening one student's history is usually deciding whether to
 * trust today's status, and the previous values are the evidence for that
 * decision, not the first thing on screen. Dumping a dozen rows of
 * status/period/notes diffs in front of that reader is how a real correction gets
 * skimmed past.
 *
 * So the default is CLOSED. Each correction shows what it cost — how many fields,
 * who, when — and the field-by-field before/after appears on click. The reason is
 * shown without a click, because "why" is the part a reader judges the decision
 * by; the values are the part they check afterwards.
 *
 * ## WHY IT REUSES THE CONFIG MODULE'S DECODING
 *
 * `oldValue`/`newValue` are tagged envelopes (`{"kind":"null"}` is a value, an
 * absent key is not), so rendering one requires reading `kind` first. That logic
 * is already written, tested and shared; a second `decodeValue` for attendance
 * would be a second set of rules for the same column, and the two would drift on
 * the first new envelope tag.
 *
 * What this file adds is the ACTOR'S NAME. `groupAmendments` falls back to the
 * raw `userId` — a cuid — which is unreadable exactly where it matters most, so
 * the route selects `user.name` alongside and this file attaches it per group
 * afterwards rather than re-implementing the grouping.
 */

/** One edit, with the person who made it named rather than identified by cuid. */
export interface AttendanceEdit extends AmendmentGroup {
  /** The account's display name, or null when it could not be resolved. */
  readonly actorName: string | null
}

/** Where one record's trail is read from. */
export function attendanceHistoryEndpoint(recordId: string): string {
  return `/api/attendance/${encodeURIComponent(recordId)}/amendments`
}

/**
 * Attach the actor's name to each group, by `groupId`.
 *
 * A second pass over the SAME rows rather than a re-implementation of
 * `groupAmendments`: the grouping key is `groupId` in both, and a second
 * grouper would be a second definition of "one edit" that could disagree with the
 * one the config screen uses. A row with no resolvable name leaves the group with
 * `actorName: null`, and `actorLabelOf` then falls back to the id — the reader
 * sees an account rather than nothing.
 */
export function nameTheActors(rows: unknown, groups: AmendmentGroup[]): AttendanceEdit[] {
  const names = new Map<string, string>()
  if (Array.isArray(rows)) {
    for (const row of rows as Array<{ groupId?: unknown; user?: { name?: unknown } | null }>) {
      const groupId = typeof row?.groupId === 'string' ? row.groupId : ''
      const name = row?.user?.name
      if (groupId && typeof name === 'string' && name !== '' && !names.has(groupId)) {
        names.set(groupId, name)
      }
    }
  }
  return groups.map((group) => ({ ...group, actorName: names.get(group.groupId) ?? null }))
}

/** What a reader sees as the actor: the name, or the account if it is unresolvable. */
export function actorLabelOf(edit: AttendanceEdit): string {
  return edit.actorName ?? edit.actor
}

/** The three things a history read can be, kept apart. */
export type AttendanceHistoryRead =
  | { status: 'ok'; groups: AttendanceEdit[] }
  | { status: 'failed'; message: string }

/** The part of `fetch` this read uses, so a test can supply the transport. */
export interface AttendanceFetch {
  (endpoint: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
}

/**
 * Read one record's trail, with the transport supplied.
 *
 * `renderToStaticMarkup` never runs an effect and the portal has no DOM harness,
 * so a `fetch` written inline in the dialog could not be exercised at all: the
 * effect that calls it is the one part that genuinely needs a browser. Keeping
 * the request here means the response classification, the grouping and the
 * envelope decoding are all executed by a test.
 *
 * There is NO `not-implemented` branch. The config module needs one because its
 * endpoint does not exist; this route does, and a 404 here means the record is
 * not in the caller's scope, which is a failure to say rather than a feature to
 * announce.
 */
export async function loadAttendanceHistory(
  endpoint: string,
  doFetch: AttendanceFetch = fetch as AttendanceFetch,
): Promise<AttendanceHistoryRead> {
  let res: Awaited<ReturnType<AttendanceFetch>>
  try {
    res = await doFetch(endpoint)
  } catch {
    return {
      status: 'failed',
      message: 'Could not reach the server. Check your connection and try again.',
    }
  }
  if (!res.ok) {
    if (res.status === 404) {
      return { status: 'failed', message: 'That attendance record is not visible to you.' }
    }
    if (res.status === 403) {
      return { status: 'failed', message: 'You do not have permission to read this register.' }
    }
    return { status: 'failed', message: `Could not load amendment history (${res.status}).` }
  }
  const payload = (await res.json()) as { data?: unknown }
  return { status: 'ok', groups: nameTheActors(payload.data, groupAmendments(payload.data)) }
}

/**
 * The reading half, with no fetching and no state of its own.
 *
 * `expandedGroupId` is a PROP rather than `useState` here, which is what makes
 * "the previous value is hidden until the reader asks for it" a claim a test can
 * check: render with no expansion and assert the old value is absent, render with
 * a `groupId` and assert it is present. The dialog above owns the state and hands
 * it down.
 */
export function AttendanceAmendmentList({
  groups,
  loading,
  error,
  studentName,
  expandedGroupId,
  onToggle,
}: {
  groups: AttendanceEdit[]
  loading: boolean
  error: string | null
  studentName: string
  expandedGroupId: string | null
  onToggle: (groupId: string) => void
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Loading amendment history…</span>
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Amendment history unavailable</AlertTitle>
        <AlertDescription>
          {error} No amendment was lost by this page failing to load; the trail is stored
          separately and an unreachable history is not a clean history.
        </AlertDescription>
      </Alert>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="py-6 text-muted-foreground">
        {/* The trail began at deployment and is never backfilled, so an empty
            history is "nothing recorded since then", not "never corrected". */}
        <p>No recorded amendments for {studentName}.</p>
        <p className="mt-1 text-sm">
          The trail began at deployment and was never backfilled, so an empty history means
          &ldquo;nothing recorded since then&rdquo;, not &ldquo;never changed&rdquo;.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const expanded = group.groupId === expandedGroupId
        return (
          <Card key={group.groupId}>
            <CardContent className="pt-6 space-y-2">
              <button
                type="button"
                onClick={() => onToggle(group.groupId)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-2 text-left"
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <Badge variant="secondary">
                  {group.fields.length} field change{group.fields.length === 1 ? '' : 's'}
                </Badge>
                <span className="font-medium">{actorLabelOf(group)}</span>
                <time className="text-sm text-muted-foreground" dateTime={group.at}>
                  {new Date(group.at).toLocaleString()}
                </time>
              </button>

              {/* The reason is always visible. It is the part the reader judges
                  the correction BY; the previous values are the part they check
                  afterwards, so those wait for the click. */}
              <p className="text-sm pl-6">
                <span className="font-medium">Why: </span>
                {group.reason}
              </p>

              {expanded ? (
                <table className="w-full text-sm pl-6">
                  <caption className="sr-only">
                    Values before and after this correction to {studentName}
                  </caption>
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="py-1">Field</th>
                      <th scope="col" className="py-1">Was</th>
                      <th scope="col" className="py-1">Became</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.fields.map((change, index) => (
                      <tr key={`${group.groupId}-${change.field}-${index}`} className="border-b">
                        <td className="py-1 align-top font-mono text-xs">{change.field}</td>
                        <td className="py-1 align-top">{change.before}</td>
                        <td className="py-1 align-top">{change.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="pl-6 text-sm text-muted-foreground">
                  Select to see the previous values.
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

/**
 * The dialog that fetches the trail and hands it to the list.
 *
 * `markedByName` and `markedAt` are shown above the corrections because the whole
 * point of the fix is that they are now stable: the person who first marked the
 * register keeps their name on the row while every later correction is recorded
 * separately beneath it. Showing both together is what makes "changed after the
 * fact" legible as a different thing from "always wrong".
 */
export function AttendanceAmendmentHistory({
  open,
  onClose,
  recordId,
  studentName,
  markedByName,
  markedAt,
}: {
  open: boolean
  onClose: () => void
  recordId: string
  studentName: string
  markedByName: string | null
  markedAt: string | null
}) {
  const [groups, setGroups] = useState<AttendanceEdit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null)

  const endpoint = attendanceHistoryEndpoint(recordId)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setExpandedGroupId(null)
    const read = await loadAttendanceHistory(endpoint)
    setError(read.status === 'ok' ? null : read.message)
    setGroups(read.status === 'ok' ? read.groups : [])
    setLoading(false)
  }, [endpoint])

  useEffect(() => {
    if (!open) return
    const run = async () => {
      await load()
    }
    void run()
  }, [open, load])

  const toggle = useCallback((groupId: string) => {
    setExpandedGroupId((current) => (current === groupId ? null : groupId))
  }, [])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" aria-hidden="true" />
            Amendment history — {studentName}
          </DialogTitle>
          <DialogDescription>
            Every recorded correction to this register entry, newest first. One correction reads
            as one entry however many fields it changed, and the previous values stay hidden until
            you ask for them.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border px-3 py-2 text-sm">
          <span className="font-medium">Marked by: </span>
          <span>{markedByName ?? 'an account that has since been removed'}</span>
          {markedAt ? (
            <>
              {' · '}
              <time dateTime={markedAt}>{new Date(markedAt).toLocaleString()}</time>
            </>
          ) : null}
        </div>

        <AttendanceAmendmentList
          groups={groups}
          loading={loading}
          error={error}
          studentName={studentName}
          expandedGroupId={expandedGroupId}
          onToggle={toggle}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}