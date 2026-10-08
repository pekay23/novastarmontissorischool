'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge, Skeleton, Button, useToast } from '@novastar/shared-ui'
import { Shield, Database, Mail, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

/** Mirrors the JSON shape returned by `GET /api/system/health`. */
interface HealthStatus {
  database: { status: 'ok' | 'warning' | 'error'; latency?: number }
  lastSync: { timestamp: string | null; pending: number }
  storage: { used: number; total: number; percentage: number }
  email: { available: boolean }
}

export default function HealthPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  /**
   * Why `health` is still null after a fetch finished. Null while loading or once
   * health has arrived; a message otherwise. Without this the page rendered its
   * skeleton for `loading || !health`, so a failed fetch left a spinner running
   * forever and the Refresh control — which lives in the branch that never
   * rendered — with no way to retry.
   */
  const [loadError, setLoadError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthStatus | null>(null)

  const role = (session?.user as { role?: string })?.role

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/system/health')
      if (!res.ok) {
        if (res.status === 403) {
          toast.error({ title: 'Access denied', description: 'Only Head of School can view system health.' })
          setLoadError('Only Head of School can view system health.')
        } else {
          setLoadError(`The server returned ${res.status}. Check your connection and try again.`)
        }
        return
      }
      const data = await res.json()
      setHealth(data)
      setLoadError(null)
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load system health.' })
      setLoadError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (role === 'HEADMASTER') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchHealth()
    }
  }, [role, fetchHealth])

  if (role !== 'HEADMASTER') {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h1 className="text-3xl font-heading font-bold">System Health</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Only the Head of School can view system health.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const getStatusIcon = (status: 'ok' | 'warning' | 'error') => {
    switch (status) {
      case 'ok': return <CheckCircle className="h-5 w-5 text-green-500" />
      case 'warning': return <AlertCircle className="h-5 w-5 text-amber-500" />
      case 'error': return <XCircle className="h-5 w-5 text-red-500" />
    }
  }

  const formatBytes = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = bytes
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-heading font-bold">System Health</h1>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    )
  }

  // A fetch that finished without producing a health payload has nothing to
  // render, and must not fall through to the skeleton above: the user would
  // watch it forever with no way to retry.
  if (!health) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-3xl font-heading font-bold">System Health</h1>
        <Card>
          <CardContent className="pt-6 flex flex-col items-start gap-4">
            <p className="text-muted-foreground">
              {loadError ?? 'System health data is not available.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void fetchHealth()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          <div>
            <h1 className="text-3xl font-heading font-bold">System Health</h1>
            <p className="text-sm text-muted-foreground">
              Monitor Novastar Montessori School system status
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchHealth}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Database Connectivity</CardTitle>
          <CardDescription>Primary database connection status and latency</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {getStatusIcon(health.database.status)}
            <div>
              <p className="font-medium">
                {health.database.status === 'ok'
                  ? 'Connected'
                  : health.database.status === 'warning'
                  ? 'Degraded'
                  : 'Disconnected'}
              </p>
              {health.database.latency !== undefined && (
                <p className="text-sm text-muted-foreground">
                  Latency: {health.database.latency}ms
                </p>
              )}
            </div>
          </div>
          <Database className="h-8 w-8 text-muted-foreground" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Offline Sync</CardTitle>
          <CardDescription>Local database sync status</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm">Last sync</span>
            <span className="font-medium">
              {health.lastSync.timestamp
                ? new Date(health.lastSync.timestamp).toLocaleString()
                : 'Never'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">Pending writes</span>
            <Badge variant={health.lastSync.pending > 0 ? 'outline' : 'default'}>
              {health.lastSync.pending} pending
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>Storage usage for application data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">Used</span>
            <span className="font-medium">
              {formatBytes(health.storage.used)} of {formatBytes(health.storage.total)}
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.min(100, health.storage.percentage)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {health.storage.percentage.toFixed(1)}% used
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Delivery</CardTitle>
          <CardDescription>Transactional email service status</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {health.email.available ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-500" />
            )}
            <div>
              <p className="font-medium">{health.email.available ? 'Available' : 'Not configured'}</p>
              <p className="text-sm text-muted-foreground">
                {health.email.available
                  ? 'Email delivery active'
                  : 'An administrator must configure an email provider to enable notifications'}
              </p>
            </div>
          </div>
          <Mail className="h-8 w-8 text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  )
}


