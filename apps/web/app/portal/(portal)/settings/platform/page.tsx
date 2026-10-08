'use client'
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, useToast, Skeleton } from '@novastar/shared-ui'
import { Shield, Settings, Database, AlertCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

interface PlatformStats {
  featureFlags: { total: number; enabled: number }
  systemErrors: { total: number; unresolved: number }
  lastSync: string | null
}

export default function PlatformPage() {
  const { data: session } = useSession()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<PlatformStats | null>(null)

  const role = (session?.user as { role?: string })?.role

  useEffect(() => {
    if (role !== 'HEADMASTER') return

    const fetchStats = async () => {
      setLoading(true)
      try {
        const [flagsRes, errorsRes] = await Promise.all([
          fetch('/api/system/config'),
          fetch('/api/system/errors?limit=1'),
        ])

        if (flagsRes.ok) {
          const flagsData = await flagsRes.json()
          const enabled = flagsData.flags.filter((f: { value: unknown }) => f.value === true).length
          setStats((prev) => ({
            ...(prev ?? { systemErrors: { total: 0, unresolved: 0 }, lastSync: null }),
            featureFlags: { total: flagsData.flags.length, enabled },
          }))
        }

        if (errorsRes.ok) {
          const errorsData = await errorsRes.json()
          setStats((prev) => ({
            ...(prev ?? { featureFlags: { total: 0, enabled: 0 }, lastSync: null }),
            systemErrors: { total: errorsData.total, unresolved: errorsData.errors.filter((e: { resolved: boolean }) => !e.resolved).length },
          }))
        }
      } catch {
        toast.error({ title: 'Error', description: 'Failed to load platform stats.' })
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [role, toast])

  if (role !== 'HEADMASTER') {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          <h1 className="text-3xl font-heading font-bold">Platform Settings</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Only the Head of School role can access platform settings.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const tiles = [
    {
      title: 'Feature Flags',
      description: 'Manage AI, SMS, SSO, and other platform features',
      icon: Settings,
      href: '/settings/platform/feature-flags',
      stat: stats ? `${stats.featureFlags.enabled}/${stats.featureFlags.total} enabled` : undefined,
      loading: loading,
    },
    {
      title: 'System Health',
      description: 'Database, storage, email, and sync status',
      icon: Database,
      href: '/settings/platform/health',
      loading: loading,
    },
    {
      title: 'System Errors',
      description: 'View and resolve platform error logs',
      icon: AlertCircle,
      href: '/settings/platform/errors',
      stat: stats ? `${stats.systemErrors.unresolved} unresolved` : undefined,
      loading: loading,
    },
  ]

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">Platform Settings</h1>
        <p className="text-sm text-muted-foreground">
          Head of School configuration for Novastar Montessori School
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Link key={tile.href} href={tile.href}>
              <Card className="cursor-pointer transition-shadow hover:shadow-md">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{tile.title}</CardTitle>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <CardDescription>{tile.description}</CardDescription>
                  {tile.loading ? (
                    <Skeleton className="h-4 w-24 mt-2" />
                  ) : tile.stat ? (
                    <p className="text-sm font-medium text-muted-foreground mt-2">{tile.stat}</p>
                  ) : null}
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}


