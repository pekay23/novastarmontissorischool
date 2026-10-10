'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  Card, CardContent,
  Button, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Input, useToast, Skeleton,
} from '@novastar/shared-ui'
import { Shield, AlertCircle, CheckCircle, XCircle, RefreshCw, Filter } from 'lucide-react'

type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

/** Mirrors the JSON shape returned by `GET /api/system/errors`. */
interface SystemError {
  id: string
  errorType: string
  message: string
  endpoint: string | null
  severity: Severity
  resolved: boolean
  resolvedAt: string | null
  user: { id: string; name: string | null } | null
  resolvedByUser: { id: string; name: string | null } | null
  createdAt: string
  updatedAt: string
}

interface ErrorsResponse {
  errors: SystemError[]
  total: number
  limit: number
  offset: number
}

const SEVERITY_COLORS: Record<Severity, 'destructive' | 'outline' | 'secondary' | 'default'> = {
  CRITICAL: 'destructive',
  HIGH: 'outline',
  MEDIUM: 'secondary',
  LOW: 'default',
}

const SEVERITY_ICONS: Record<Severity, React.JSX.Element> = {
  CRITICAL: <XCircle className="h-4 w-4 text-red-500" />,
  HIGH: <AlertCircle className="h-4 w-4 text-red-400" />,
  MEDIUM: <AlertCircle className="h-4 w-4 text-amber-400" />,
  LOW: <AlertCircle className="h-4 w-4 text-blue-400" />,
}

export default function ErrorsPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [errors, setErrors] = useState<ErrorsResponse | null>(null)
  const [selectedSeverity, setSelectedSeverity] = useState<string>('')
  const [resolvedFilter, setResolvedFilter] = useState<string>('')
  const [errorTypeFilter, setErrorTypeFilter] = useState('')
  // Debounced mirror of the search box. Without it every keystroke fires a
  // request and re-renders the table under the user's cursor.
  const [debouncedErrorType, setDebouncedErrorType] = useState('')

  // Distinguishes the first fetch (which replaces the page) from later ones
  // (which do not). A ref, not state: changing it must not trigger a render.
  const hasLoadedRef = useRef(false)

  // Pagination lives in the URL so Next/Previous are real navigation.
  const searchParams = useSearchParams()
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedErrorType(errorTypeFilter), 300)
    return () => clearTimeout(timer)
  }, [errorTypeFilter])

  const role = (session?.user as { role?: string })?.role

  /**
   * `initial` marks the first load, which replaces the page with a skeleton.
   * Filter changes keep the table mounted and only dim it, so the search
   * input does not lose focus (and the caret position) on every keystroke.
   */
  const fetchErrors = useCallback(async () => {
    // Only the very first fetch replaces the page with a skeleton. Filter and
    // pagination changes keep the table mounted so the search input does not
    // lose focus (and the caret position).
    if (hasLoadedRef.current) setRefreshing(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedSeverity) params.set('severity', selectedSeverity)
      if (resolvedFilter) params.set('resolved', resolvedFilter)
      if (debouncedErrorType) params.set('errorType', debouncedErrorType)
      params.set('limit', String(limit))
      params.set('offset', String(offset))

      const res = await fetch(`/api/system/errors?${params.toString()}`)
      if (!res.ok) {
        if (res.status === 403) {
          toast.error({ title: 'Access denied', description: 'Only Head of School can view system errors.' })
        } else {
          setLoadFailed(true)
        }
        return
      }
      const data: ErrorsResponse = await res.json()
      setErrors(data)
      hasLoadedRef.current = true
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
      toast.error({ title: 'Error', description: 'Failed to load system errors.' })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [selectedSeverity, resolvedFilter, debouncedErrorType, limit, offset, toast])

  useEffect(() => {
    if (role === 'HEADMASTER') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchErrors()
    }
  }, [role, fetchErrors])

  const handleResolve = async (id: string, resolved: boolean) => {
    try {
      const res = await fetch(`/api/system/errors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved }),
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success({ title: 'Success', description: `Error marked as ${resolved ? 'resolved' : 'unresolved'}.` })
      void fetchErrors()
    } catch {
      toast.error({ title: 'Error', description: 'Failed to update error status.' })
    }
  }

  if (role !== 'HEADMASTER') {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h1 className="text-3xl font-heading font-bold">System Errors</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Only the Head of School can view system errors.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const clearFilters = () => {
    setSelectedSeverity('')
    setResolvedFilter('')
    setErrorTypeFilter('')
  }

  // First load only — later fetches set `refreshing` and leave the table
  // mounted, so the search input keeps focus while results update.
  if (loading) {
    return (
      <div className="space-y-6 p-6" aria-busy="true">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-heading font-bold">System Errors</h1>
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  // A failed first load must not leave the skeleton on screen forever.
  if (!errors) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-3xl font-heading font-bold">System Errors</h1>
        <Card>
          <CardContent className="pt-6 flex flex-col items-start gap-4">
            <p className="text-muted-foreground">
              {loadFailed
                ? 'Could not load system errors. Check your connection and try again.'
                : 'No system error data is available yet.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void fetchErrors()}>
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
          <AlertCircle className="h-5 w-5" />
          <div>
            <h1 className="text-3xl font-heading font-bold">System Errors</h1>
            <p className="text-sm text-muted-foreground">
              {errors.total} errors — {errors.errors.filter((e) => !e.resolved).length} unresolved
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchErrors()} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* A failed filter or pagination fetch leaves the previous results on
          screen. Without this the user reads stale data as current. */}
      {loadFailed && (
        <Card className="border-destructive/50">
          <CardContent className="pt-6 flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Could not refresh — these results may be out of date.
            </p>
            <Button variant="outline" size="sm" onClick={() => void fetchErrors()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-end">
        <div className="flex-1">
          <label htmlFor="errorTypeFilter" className="block text-sm font-medium mb-1">Search by Error Type</label>
          <Input
            id="errorTypeFilter"
            placeholder="e.g. ValidationError, DatabaseError"
            value={errorTypeFilter}
            onChange={(e) => setErrorTypeFilter(e.target.value)}
          />
        </div>
        <div className="w-48">
          <label htmlFor="severity" className="block text-sm font-medium mb-1">Severity</label>
          <Select value={selectedSeverity || 'all'} onValueChange={(v) => setSelectedSeverity(v === 'all' ? '' : v)}>
            <SelectTrigger id="severity">
              <SelectValue placeholder="All severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="CRITICAL">Critical</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <label htmlFor="resolvedFilter" className="block text-sm font-medium mb-1">Status</label>
          <Select value={resolvedFilter || 'all'} onValueChange={(v) => setResolvedFilter(v === 'all' ? '' : v)}>
            <SelectTrigger id="resolvedFilter">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="true">Resolved</SelectItem>
              <SelectItem value="false">Unresolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(selectedSeverity || resolvedFilter || errorTypeFilter) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <Filter className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Error table */}
      <Card>
        <CardContent className="p-0">
          {errors.errors.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No system errors found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-sm font-medium">Severity</th>
                    <th className="text-left py-2 px-3 text-sm font-medium">Type</th>
                    <th className="text-left py-2 px-3 text-sm font-medium">Message</th>
                    <th className="text-left py-2 px-3 text-sm font-medium">Endpoint</th>
                    <th className="text-left py-2 px-3 text-sm font-medium">User</th>
                    <th className="text-left py-2 px-3 text-sm font-medium">Date</th>
                    <th className="text-left py-2 px-3 text-sm font-medium">Status</th>
                    <th className="text-right py-2 px-3 text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.errors.map((error) => (
                    <tr key={error.id} className="border-b">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          {SEVERITY_ICONS[error.severity]}
                          <Badge variant={SEVERITY_COLORS[error.severity]}>
                            {error.severity}
                          </Badge>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-sm font-mono">{error.errorType}</td>
                      <td className="py-2 px-3 text-sm max-w-md truncate">{error.message}</td>
                      <td className="py-2 px-3 text-sm text-muted-foreground font-mono">
                        {error.endpoint || '—'}
                      </td>
                      <td className="py-2 px-3 text-sm">
                        {error.user?.name || 'System'}
                      </td>
                      <td className="py-2 px-3 text-sm text-muted-foreground">
                        {new Date(error.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-3">
                        {error.resolved ? (
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            Resolved
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Open</Badge>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {error.resolved ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleResolve(error.id, false)}
                          >
                            Reopen
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleResolve(error.id, true)}
                            aria-label={`Mark ${error.errorType} error as resolved`}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {errors.total > errors.limit && (
        <div className="flex justify-center gap-2">
          {errors.offset > 0 && (
            <Button
              asChild
              variant="outline"
              size="sm"
            >
              <Link href={`/settings/platform/errors?limit=${errors.limit}&offset=${Math.max(0, errors.offset - errors.limit)}`}>
                Previous
              </Link>
            </Button>
          )}
          {errors.offset + errors.limit < errors.total && (
            <Button
              asChild
              variant="outline"
              size="sm"
            >
              <Link href={`/settings/platform/errors?limit=${errors.limit}&offset=${errors.offset + errors.limit}`}>
                Next
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
