'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
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
  Skeleton,
  Switch,
  useToast,
} from '@novastar/shared-ui'
import { DoorOpen, Info, RefreshCw, Shield } from 'lucide-react'
import {
  ADMISSIONS_MANAGER_ROLES,
  canManageAdmissions,
  parsePlatformRole,
} from '@/lib/constants/platform-roles'

/**
 * Mirrors the body of `GET /api/admissions/status`.
 *
 * `isOverridden: false` with `version: 0` is a complete answer, not a missing
 * one: no row has been written, so the value is the registry default and the
 * version is the token for that absence. `version` is the optimistic-concurrency
 * token for the stored state and increments on every write; it is echoed back
 * as `expectedVersion` so a write based on state this page has not seen is
 * refused instead of overwriting someone else's change.
 */
interface AdmissionsStatus {
  open: boolean
  isOverridden: boolean
  updatedAt: string | null
  version: number
}

/** Mirrors the `{ status }` body returned by `PATCH /api/admissions/status`. */
interface PatchedStatusResponse {
  status: AdmissionsStatus
}

export default function AdmissionsPage() {
  const { data: session, status: sessionStatus } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<AdmissionsStatus | null>(null)
  /**
   * The value the operator has asked for but the server has not yet confirmed.
   * `null` means "no write in flight, render the stored value". Kept apart from
   * `status` so a rejected write cannot leave the switch showing a value that
   * was never stored, and so an in-flight write never contaminates the
   * `version` the next precondition is built from.
   */
  const [pendingOpen, setPendingOpen] = useState<boolean | null>(null)
  /** Set when the endpoint refuses this caller, however the gate above decided. */
  const [forbidden, setForbidden] = useState(false)

  /**
   * Newest request issued, whether a GET or a PATCH. Shared deliberately: a
   * read and a write can interleave, and a GET whose response was produced
   * before a PATCH landed would otherwise repaint stale state over a change the
   * operator has already made. A ref, not state: sequencing must not re-render
   * the page.
   */
  const requestSeqRef = useRef(0)

  // Narrowed before the gate, so an unrecognised role name denies rather than
  // being cast away, and the permitted set stays the single list in
  // `lib/constants/platform-roles` rather than a second copy of it here.
  const role = parsePlatformRole((session?.user as { role?: string } | undefined)?.role)
  const permitted = canManageAdmissions(role)

  const fetchStatus = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setLoading(true)
    try {
      const res = await fetch('/api/admissions/status')
      if (res.status === 403) {
        // The page gate already refused this caller, so a 403 on the read means
        // the endpoint's permitted set and this page's have drifted apart.
        // Rendered as the same refusal: a bare skeleton would read as "still
        // loading" for ever, and an empty card as "no admissions configured".
        setForbidden(true)
        return
      }
      if (!res.ok) throw new Error('Failed to load the admissions status')
      const data: AdmissionsStatus = await res.json()
      if (requestSeqRef.current !== seq) return
      // Accepted as loaded whether or not a row exists. An unconfigured school
      // gets `isOverridden: false` and `version: 0`, and the correct thing to
      // show them is Closed — treating that as "no data yet" would park a
      // school that has never configured admissions on a loading skeleton
      // instead of on the word Closed.
      setStatus(data)
    } catch {
      // A superseded request has nothing useful to say: its answer describes a
      // state that a newer request has already replaced.
      if (requestSeqRef.current !== seq) return
      toast.error({ title: 'Error', description: 'Failed to load the admissions status.' })
    } finally {
      // Deliberately unconditional: a superseded request still has to release
      // the page, or the newer one would leave the skeleton up for good.
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!permitted) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchStatus()
  }, [permitted, fetchStatus])

  /**
   * Persist a new admissions state.
   *
   * Every request carries the `version` this page rendered as an
   * `expectedVersion` precondition. That turns a second tab saving the same
   * switch from a silent last-write-wins into a refused write: this request
   * describes a state that has since moved, so applying it would discard
   * whatever replaced it — and the audit trail would show one change where two
   * were made.
   *
   * `version: 0` is sent as-is. It is the token the server reports when no
   * override row exists, so it is the correct precondition for the first write,
   * not a stand-in for "unknown". Only the absence of a loaded status omits the
   * field, and that state never renders a control to press.
   */
  const persist = async (nextOpen: boolean) => {
    const seq = ++requestSeqRef.current
    setSaving(true)
    setPendingOpen(nextOpen)
    try {
      const res = await fetch('/api/admissions/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          open: nextOpen,
          ...(status ? { expectedVersion: status.version } : {}),
        }),
      })
      // Nothing was written, so there is nothing to retry: resync and let the
      // operator decide again. Replaying the request would overwrite the change
      // it just collided with, which is the exact failure the precondition
      // exists to prevent.
      if (res.status === 409) {
        const conflict = (await res.json().catch(() => ({}))) as {
          details?: { currentVersion?: number }
        }
        // A newer write has landed, so this conflict describes a state that is
        // already superseded and its message would be noise.
        if (requestSeqRef.current === seq) {
          toast.error({
            title: 'Changed elsewhere',
            description:
              'Admissions was changed in another session' +
              (conflict.details?.currentVersion !== undefined
                ? ` (now at version ${conflict.details.currentVersion}).`
                : '.') +
              ' Reloading the current value.',
          })
          void fetchStatus()
        }
        return
      }
      // Plain-text body, so it is not worth parsing — the reason is the page
      // gate already decided, not something the operator can act on.
      if (res.status === 403) {
        if (requestSeqRef.current === seq) {
          setForbidden(true)
          toast.error({
            title: 'Access denied',
            description: 'You are not permitted to change the admissions status.',
          })
        }
        return
      }
      if (res.status === 400) {
        const rejected = (await res.json().catch(() => null)) as { error?: unknown } | null
        if (requestSeqRef.current === seq) {
          toast.error({
            title: 'Not saved',
            description:
              typeof rejected?.error === 'string'
                ? rejected.error
                : 'The admissions status was rejected as invalid.',
          })
        }
        return
      }
      if (!res.ok) throw new Error('Failed to save the admissions status')
      const data: PatchedStatusResponse = await res.json()
      // A newer write has landed while this one was in flight, so whatever the
      // server stored by now is not what this response describes: drop it and
      // let the newer request's response stand.
      if (requestSeqRef.current !== seq) return
      // Trust the server's view: the persisted timestamp, whether an override
      // row now exists, and the version to send next time are exactly what the
      // badges, the timestamp and the next precondition render, and only the
      // server knows any of them.
      setStatus(data.status)
      toast.success({
        title: data.status.open ? 'Admissions opened' : 'Admissions closed',
        description:
          'The portal now records this change. The public website picks it up at its next rebuild.',
      })
    } catch {
      if (requestSeqRef.current !== seq) return
      toast.error({ title: 'Error', description: 'Failed to save the admissions status.' })
      // Re-sync from the server so the switch cannot keep showing a value that
      // was never persisted.
      void fetchStatus()
    } finally {
      // Both flags are released unconditionally: a superseded or failed write
      // still has to give the control back, or the switch would stay disabled
      // over a value nobody can now change.
      setSaving(false)
      setPendingOpen(null)
    }
  }

  /**
   * The roles allowed to change this, read from the one list the endpoint also
   * authorises against. Rendered rather than restated in prose: a second copy
   * of the list in a sentence is a copy that can drift from the check.
   */
  const permittedRoles = (
    <div className="mt-6 border-t pt-4">
      <p className="text-sm text-muted-foreground">These roles can open and close admissions:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ADMISSIONS_MANAGER_ROLES.map((permittedRole) => (
          <Badge key={permittedRole} variant="outline">
            {permittedRole}
          </Badge>
        ))}
      </div>
    </div>
  )

  if (sessionStatus === 'loading') {
    // Distinguished from the load below because the session role is what the
    // gate below turns on. Rendering the refusal here would tell an authorised
    // operator they may not do their job for as long as NextAuth resolves.
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-5 w-5" />
          <h1 className="text-3xl font-heading font-bold">Admissions</h1>
        </div>
        <Skeleton className="h-[240px] w-full" />
      </div>
    )
  }

  if (!permitted || forbidden) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-5 w-5" />
          <h1 className="text-3xl font-heading font-bold">Admissions</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <p className="font-medium">You cannot open or close admissions</p>
            </div>
            <p className="mt-2 text-muted-foreground">
              Ask the Head of School to make the change, or to have your role adjusted.
            </p>
            {permittedRoles}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading || !status) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DoorOpen className="h-5 w-5" />
            <h1 className="text-3xl font-heading font-bold">Admissions</h1>
          </div>
        </div>
        <Skeleton className="h-[240px] w-full" />
      </div>
    )
  }

  // The switch and the badges read the same value, so the page cannot show a
  // toggle one way and a word the other while a write is in flight.
  const shownOpen = pendingOpen ?? status.open

  const summary = !status.isOverridden
    ? 'Nobody has set admissions for this school yet, so it is closed because closed is the default. Your first change is recorded and dated.'
    : shownOpen
      ? 'Families can apply once the website has been rebuilt with this setting.'
      : 'The portal is not accepting applications. The website follows at its next rebuild.'

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-5 w-5" />
          <div>
            <h1 className="text-3xl font-heading font-bold">Admissions</h1>
            <p className="text-sm text-muted-foreground">
              Whether Novastar Montessori School is accepting applications
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatus}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/*
        The propagation caveat is in the page, not only in a comment, because the
        failure it prevents is a silent one: the operator flips the switch, sees
        a success toast, and walks away believing the live site has changed. It
        has not — the site is a static export whose admissions page is generated
        at build time from this flag, so what a visitor sees is the value as of
        the last build.
      */}
      <Alert role="note">
        <Info className="h-4 w-4" />
        <AlertTitle>The live website does not change until the site is rebuilt</AlertTitle>
        <AlertDescription>
          <p>
            The public website is a static export. Its admissions page is generated
            when the site is built, not when a visitor arrives, so it cannot read this
            switch on request.
          </p>
          <p className="mt-2">
            This switch changes the portal immediately and the website only after the site
            is rebuilt and redeployed. Until that happens the published page keeps the
            previous build&rsquo;s wording &mdash; the application form when it was built
            open, and the &ldquo;Admissions currently closed&rdquo; notice when it was not.
          </p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Admissions status</CardTitle>
          <CardDescription>
            Open while the school is accepting applications, closed when it is not.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={shownOpen ? 'default' : 'secondary'}>
                  {shownOpen ? 'Open' : 'Closed'}
                </Badge>
                {status.isOverridden ? (
                  <Badge variant="outline">Deliberately set</Badge>
                ) : (
                  <Badge variant="outline">Using the default</Badge>
                )}
                {/* Only an override has a row, and only a row has a timestamp —
                    a switch nobody has touched was never written, so there is no
                    change to report. */}
                {status.isOverridden && status.updatedAt && (
                  <span className="text-xs text-muted-foreground">
                    Last changed {new Date(status.updatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground max-w-md">{summary}</p>
            </div>
            <div className="flex items-center gap-2">
              {saving && <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />}
              <Switch
                checked={shownOpen}
                onCheckedChange={(value) => void persist(value)}
                disabled={saving}
                aria-busy={saving}
                aria-label="Accept applications"
              />
            </div>
          </div>
          {permittedRoles}
        </CardContent>
      </Card>
    </div>
  )
}
