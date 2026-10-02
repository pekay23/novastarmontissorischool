'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Switch, useToast, Skeleton } from '@novastar/shared-ui'
import { Settings, Save, RefreshCw, Shield } from 'lucide-react'

interface FlagDefinition {
  description: string
  category: string
  defaultValue: unknown
}

interface ConfigFlag {
  key: string
  value: unknown
  description: string
  category: string
  isEditable: boolean
  updatedAt: string
}

interface ConfigResponse {
  flags: ConfigFlag[]
  definitions: Record<string, FlagDefinition>
}

export default function FeatureFlagsPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [localFlags, setLocalFlags] = useState<Record<string, unknown>>({})

  const role = (session?.user as { role?: string })?.role

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/system/config')
      if (!res.ok) {
        if (res.status === 403) {
          toast.error({ title: 'Access denied', description: 'You must be Head of School to view platform settings.' })
        }
        return
      }
      const data: ConfigResponse = await res.json()
      setConfig(data)
      const initial: Record<string, unknown> = {}
      data.flags.forEach((f) => {
        initial[f.key] = f.value
      })
      setLocalFlags(initial)
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load feature flags.' })
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
   * Persist a flag value. Takes the value explicitly rather than reading it
   * back out of `localFlags`, because a reset sets state and saves in the same
   * tick — reading the state there would send the pre-reset value.
   */
  const persistFlag = async (key: string, value: unknown) => {
    setSaving((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await fetch(`/api/system/config/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) throw new Error('Failed to save')
      const data = await res.json()
      // Update the flag in local state with server response
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              flags: prev.flags.map((f) =>
                f.key === key ? { ...f, value: data.flag.value } : f
              ),
            }
          : null
      )
      toast.success({ title: 'Saved', description: `Feature flag '${key}' updated.` })
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save feature flag.' })
      // Re-sync from the server so the switch cannot keep showing a value
      // that was never persisted.
      void fetchConfig()
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }))
    }
  }

  const handleSave = (key: string) => {
    void persistFlag(key, localFlags[key])
  }

  const handleReset = (key: string) => {
    const def = config?.definitions[key]
    if (!def) return
    setLocalFlags((prev) => ({ ...prev, [key]: def.defaultValue }))
    void persistFlag(key, def.defaultValue)
  }

  if (loading || !config) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-heading font-bold">Feature Flags</h1>
        </div>
        <Skeleton className="h-[400px] w-full" />
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
                  </div>
                  <p className="text-sm text-muted-foreground max-w-md">
                    {flag.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={localFlags[flag.key] as boolean}
                    onCheckedChange={(val) => handleToggle(flag.key, val)}
                    disabled={!flag.isEditable || saving[flag.key]}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleSave(flag.key)}
                    disabled={saving[flag.key] || !flag.isEditable}
                  >
                    {saving[flag.key] ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReset(flag.key)}
                    disabled={saving[flag.key] || !flag.isEditable}
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
