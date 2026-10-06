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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@novastar/shared-ui'
import { Loader2 } from 'lucide-react'
import { historyReadMessage, loadAmendmentGroups, type AmendmentGroup } from './amendment'

/**
 * Who changed what, when, and why — for one record.
 *
 * READ AS EDITS, NOT ROWS. `RecordAmendment` stores one row per changed field, so
 * a three-field correction is three rows that share one writer-minted `groupId`
 * and one reason. Rendering the rows flat would present one decision as three,
 * and imply three reasons where there was one. So grouping happens on read, and
 * the reason is shown ONCE per group above the fields it covers.
 *
 * `AmendmentHistoryList` is exported separately from the fetching dialog and
 * takes already-grouped entries, so the reading half can be exercised against
 * real markup without a network or a DOM harness.
 */
export function AmendmentHistoryList({
  groups,
  loading,
  error,
  entityName,
}: {
  groups: AmendmentGroup[]
  loading: boolean
  error: string | null
  entityName: string
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
          {error} No amendment was recorded by this page failing to load; the trail is stored
          separately and an unreachable history is not a clean history.
        </AlertDescription>
      </Alert>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="py-6 text-muted-foreground">
        {/* The migration is explicit that the trail starts empty and is never
            backfilled, so absence of a row is NOT evidence that a value was never
            corrected. Saying "no changes recorded" would overclaim. */}
        <p>No recorded amendments for this {entityName.toLowerCase()}.</p>
        <p className="mt-1 text-sm">
          The trail began at deployment and was never backfilled, so an empty history means
          &ldquo;nothing recorded since then&rdquo;, not &ldquo;never changed&rdquo;.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.groupId}>
          <CardContent className="pt-6 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{group.fields.length} field change{group.fields.length === 1 ? '' : 's'}</Badge>
              <time className="text-sm text-muted-foreground" dateTime={group.at}>
                {new Date(group.at).toLocaleString()}
              </time>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="font-medium">By</dt>
                <dd className="text-muted-foreground">{group.actor}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Why</dt>
                <dd>{group.reason}</dd>
              </div>
            </dl>
            <table className="w-full text-sm">
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
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * The dialog that fetches the trail and hands it to the list.
 *
 * `endpoint` is passed in rather than assembled here so the path the page builds
 * and the path the test reads are the same string, and there is exactly one place
 * in the frontend that names the not-yet-implemented route.
 */
export function AmendmentHistory({
  open,
  onClose,
  endpoint,
  entityName,
}: {
  open: boolean
  onClose: () => void
  endpoint: string
  entityName: string
}) {
  const [groups, setGroups] = useState<AmendmentGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // No branch of the read lives here: `loadAmendmentGroups` classifies the
  // response and `historyReadMessage` words it, so the untestable part of this
  // component is only "call the read when the dialog opens" and nothing else.
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const read = await loadAmendmentGroups(endpoint)
    setError(historyReadMessage(read))
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

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Amendment history</DialogTitle>
          <DialogDescription>
            Every recorded correction to this {entityName.toLowerCase()}: who made it, when, and
            why. Grouped by edit, so one correction reads as one entry however many fields it
            changed.
          </DialogDescription>
        </DialogHeader>
        <AmendmentHistoryList
          groups={groups}
          loading={loading}
          error={error}
          entityName={entityName}
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