'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Switch, useToast, Skeleton } from '@novastar/shared-ui'
import { Settings, Save, RefreshCw, Shield } from 'lucide-react'

interface FlagDefinition {
  description: string
  category: string
  defaultValue: unknown
}

/**
 * Mirrors `ResolvedFlag` from `lib/system-config.ts`.
 *
 * `version` is the optimistic-concurrency token for the stored state: `0` when
 * no override row exists, otherwise the row's own counter. It is sent back as
 * `expectedVersion` on every PATCH, so a write based on state this page has not
 * seen is refused rather than silently applied over someone else's change.
 */
interface ConfigFlag {
  key: string
  value: unknown
  description: string
  category: string
  isOverridden: boolean
  isEditable: boolean
  updatedAt: string | null
  version: number
}

interface ConfigResponse {
  flags: ConfigFlag[]
  definitions: Record<string, FlagDefinition>
}

/**
 * Mirrors the `{ flag }` body returned by `PATCH /api/system/config/[key]`.
 *
 * `version` comes from the write rather than from this page, so it is the
 * version actually stored — which is what makes the next precondition correct.
 * A `409` carries no `flag` body: its shape is
 * `{ error, details: { currentVersion } }`.
 */
interface PatchedFlagResponse {
  flag: {
    key: string
    value: unknown
    reset: boolean
    isOverridden: boolean
    updatedAt: string | null
    version: number
  }
}

export default function FeatureFlagsPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  /**
   * Why `config` is still null after a fetch finished. Null while loading or once
   * config has arrived; a message otherwise. Without this the page rendered its
   * skeleton for `loading || !config`, so a failed fetch left a spinner running
   * forever and the Refresh control — which lives in the branch that never
   * rendered — with no way to retry.
   */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [localFlags, setLocalFlags] = useState<Record<string, unknown>>({})

  /**
   * Newest PATCH issued per key. `saving[key]` only stops a *subsequent
   * render* from sending a second one — two clicks in the same tick both fire,
   * and a second browser tab shares no state at all — so without this a slow
   * earlier response can arrive last and overwrite a newer value and
   * timestamp with stale ones. A ref, not state: sequencing must not re-render
   * the page.
   */
  const requestSeqRef = useRef<Record<string, number>>({})

  const role = (session?.user as { role?: string })?.role

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/system/config')
      if (!res.ok) {
        if (res.status === 403) {
          toast.error({ title: 'Access denied', description: 'You must be Head of School to view platform settings.' })
          setLoadError('You must be Head of School to view platform settings.')
        } else {
          setLoadError(`The server returned ${res.status}. Check your connection and try again.`)
        }
        return
      }
      const data: ConfigResponse = await res.json()
      setConfig(data)
      setLoadError(null)
      const initial: Record<string, unknown> = {}
      data.flags.forEach((f) => {
        initial[f.key] = f.value
      })
      setLocalFlags(initial)
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load feature flags.' })
      setLoadError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (role === 'HEADMASTER') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchConfig()
    }
  }, [role, fetchConfig])

  if (role !== 'HEADMASTER') {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h1 className="text-3xl font-heading font-bold">Feature Flags</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Only the Head of School can manage platform feature flags.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleToggle = (key: string, value: boolean) => {
    setLocalFlags((prev) => ({ ...prev, [key]: value }))
  }

  /**
   * Persist a flag.
   *
   * `reset: true` asks the server to drop the stored override so the flag
   * falls back to its registry default, and carries no value: writing the
   * default back instead would leave a permanent override shadowing any future
   * change to that default. A write carries the value to store.
   *
   * Every request carries the `version` this page last rendered as an
   * `expectedVersion` precondition. That is what turns a second tab saving the
   * same flag from a silent last-write-wins into a refused write: the request
   * this page is built on described a state that has since moved, so applying
   * it would discard whatever replaced it — and the audit trail would show one
   * change where two were made.
   */
  const persistFlag = async (key: string, body: { value?: unknown; reset: boolean }) => {
    const seq = (requestSeqRef.current[key] ?? 0) + 1
    requestSeqRef.current[key] = seq
    setSaving((prev) => ({ ...prev, [key]: true }))
    try {
      const current = config?.flags.find((f) => f.key === key)
      // Omitted rather than defaulted when this page holds no row for the key: a
      // made-up 0 would manufacture a conflict against a flag that is genuinely
      // overridden, and omitting it keeps the request valid for any server that
      // treats the precondition as optional.
      const precondition = current ? { expectedVersion: current.version } : {}
      const res = await fetch(`/api/system/config/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...precondition }),
      })
      // Nothing was written, so there is nothing to retry: resync and let the
      // Head of School decide again. Replaying the request would overwrite the
      // change it just collided with, which is the exact failure the precondition
      // exists to prevent.
      if (res.status === 409) {
        const conflict = (await res.json().catch(() => ({}))) as {
          details?: { currentVersion?: number }
        }
        // A newer PATCH for this key has landed, so this conflict describes a
        // state that is already superseded and its message would be noise.
        if (requestSeqRef.current[key] === seq) {
          toast.error({
            title: 'Changed elsewhere',
            description:
              `Feature flag '${key}' was changed in another session` +
              (conflict.details?.currentVersion !== undefined
                ? ` (now at version ${conflict.details.currentVersion}).`
                : '.') +
              ' Reloading the current value.',
          })
          void fetchConfig()
        }
        return
      }
      if (!res.ok) throw new Error('Failed to save')
      const data: PatchedFlagResponse = await res.json()
      // A newer PATCH for this key has landed while this one was in flight, so
      // whatever the server stored by now is not what this response describes:
      // drop it and let the newer request's response stand.
      if (requestSeqRef.current[key] !== seq) return
      // Trust the server's view of the flag: the persisted timestamp, whether an
      // override row now exists, and the version to send next time are exactly
      // what the Override badge, the timestamp and the next precondition render,
      // and only the server knows any of them.
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              flags: prev.flags.map((f) =>
                f.key === key
                  ? {
                      ...f,
                      value: data.flag.value,
                      isOverridden: data.flag.isOverridden,
                      updatedAt: data.flag.updatedAt,
                      // Keep the token as fresh as the rest of the stored state,
                      // so the next precondition is built from what is really
                      // stored rather than from the value this page started at.
                      version: data.flag.version,
                    }
                  : f
              ),
            }
          : null
      )
      toast.success({
        title: 'Saved',
        description: data.flag.reset
          ? `Feature flag '${key}' reset to its default.`
          : `Feature flag '${key}' updated.`,
      })
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save feature flag.' })
      // Re-sync from the server so the switch cannot keep showing a value
      // that was never persisted.
      void fetchConfig()
    } finally {
      // Deliberately unconditional: a superseded request still has to release
      // the key, or the newer one would leave the controls disabled forever.
      setSaving((prev) => ({ ...prev, [key]: false }))
    }
  }

  const handleSave = (key: string) => {
    void persistFlag(key, { value: localFlags[key], reset: false })
  }

  const handleReset = (key: string) => {
    const def = config?.definitions[key]
    if (!def) return
    setLocalFlags((prev) => ({ ...prev, [key]: def.defaultValue }))
    void persistFlag(key, { reset: true })
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-heading font-bold">Feature Flags</h1>
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  // A fetch that finished without producing a config has nothing to render, and
  // must not fall through to the skeleton above: the user would watch it forever
  // with no way to retry.
  if (!config) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-3xl font-heading font-bold">Feature Flags</h1>
        <Card>
          <CardContent className="pt-6 flex flex-col items-start gap-4">
            <p className="text-muted-foreground">
              {loadError ?? 'Feature flag data is not available.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void fetchConfig()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Group flags by category
  const categories = config.flags.reduce(
    (acc, flag) => {
      const cat = flag.category || 'uncategorized'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(flag)
      return acc
    },
    {} as Record<string, ConfigFlag[]>
  )

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <div>
            <h1 className="text-3xl font-heading font-bold">Feature Flags</h1>
            <p className="text-sm text-muted-foreground">
              Manage platform feature flags for Novastar Montessori School
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchConfig}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {Object.entries(categories).map(([category, flags]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="text-lg">{category.charAt(0).toUpperCase() + category.slice(1)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {flags.map((flag) => (
              <div key={flag.key} className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                      {flag.key}
                    </code>
                    <Badge variant={flag.value ? 'default' : 'secondary'}>
                      {flag.value ? 'ON' : 'OFF'}
                    </Badge>
                    {flag.isOverridden ? (
                      <Badge variant="outline">Overridden</Badge>
                    ) : (
                      <Badge variant="outline">Default</Badge>
                    )}
                    {/* Only an override has a row, and only a row has a
                        timestamp — a flag sitting at its default was never
                        written, so there is no change to report. */}
                    {flag.isOverridden && flag.updatedAt && (
                      <span className="text-xs text-muted-foreground">
                        Last changed {new Date(flag.updatedAt).toLocaleString()}
                      </span>
                    )}
                    {!flag.isEditable && (
                      <Badge variant="destructive">Read-only</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {flag.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* A read-only flag disables all three controls below, Save
                      included — the server rejects it with a 403, so letting
                      the click through only produces a misleading toast. Reset
                      additionally needs an override to clear. */}
                  <Switch
                    checked={localFlags[flag.key] as boolean}
                    onCheckedChange={(val) => handleToggle(flag.key, val)}
                    disabled={saving[flag.key] || !flag.isEditable}
                    aria-label={`${flag.key} feature flag`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSave(flag.key)}
                    disabled={saving[flag.key] || !flag.isEditable}
                    aria-label={`Save ${flag.key}`}
                  >
                    {saving[flag.key] ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-4" />
                    )}
                  </Button>
                  {/* Only meaningful when an override exists; otherwise the flag
                      is already at its default. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReset(flag.key)}
                    disabled={saving[flag.key] || !flag.isEditable || !flag.isOverridden}
                  >
                    Reset
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
