'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Tabs, TabsList, TabsTrigger, TabsContent, Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '@novastar/shared-ui'
import { EntityType } from '@novastar/shared-types'
import { EntityList } from '@/components/config/entity-list'
import { PasskeySetup } from '@/components/auth/PasskeySetup'
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup'

const SETTINGS_SECTIONS = [
  {
    id: 'academic',
    label: 'Academic',
    icon: 'graduation-cap',
    entities: ['academic_year', 'term', 'class_level', 'subject', 'grading_scale'] as EntityType[],
  },
  {
    id: 'fees',
    label: 'Fees & Payments',
    icon: 'credit-card',
    entities: ['fee_category', 'payment_method'] as EntityType[],
  },
  {
    id: 'news',
    label: 'News & Events',
    icon: '📰',
    entities: ['news', 'event'] as EntityType[],
  },
  {
    id: 'users',
    label: 'Users & Roles',
    icon: '🛡️',
    entities: ['role'] as EntityType[],
  },
  {
    id: 'structure',
    label: 'Structure',
    icon: '🏛️',
    entities: ['department', 'house'] as EntityType[],
  },
  {
    id: 'branding',
    label: 'School Branding',
    icon: '🎨',
    entities: ['branding'] as EntityType[],
  },
  {
    id: 'security',
    label: 'Security',
    icon: '🛡️',
  },
  {
    id: 'platform',
    label: 'Platform',
    icon: '⚙️',
  },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('academic')
  const { data: session } = useSession()
  const userId = (session?.user as { id?: string })?.id
  const userEmail = (session?.user as { email?: string })?.email || ''

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Configure school settings, academic structure, fees, and user roles
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Entity Definitions</CardTitle>
            <CardDescription>Manage what entities admins can edit</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm" variant="outline">
              <a href="/settings/entities">Manage Entity Definitions</a>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/*
          Responsive rather than a fixed column count: a hard-coded
          `grid-cols-N` silently misaligns the moment a section is added or
          removed, and the eighth tab used to wrap onto an orphan row.
        */}
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          {SETTINGS_SECTIONS.map(section => (
            <TabsTrigger key={section.id} value={section.id} className="gap-2">
              <span aria-hidden="true">{section.icon}</span>
              <span>{section.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {SETTINGS_SECTIONS.map(section => (
          <TabsContent key={section.id} value={section.id} className="space-y-6">
            {section.id === 'security' ? (
              <div className="grid gap-6 lg:gap-8 max-w-2xl">
                {userEmail && (
                  <PasskeySetup userEmail={userEmail} />
                )}
                {userId && (
                  <TwoFactorSetup userId={userId} />
                )}
              </div>
            ) : section.id === 'platform' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Platform Configuration</CardTitle>
                  <CardDescription>
                    Head of School configuration for system-level settings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <nav className="flex flex-col gap-2">
                    <Button asChild variant="ghost" className="justify-start">
                      <Link href="/settings/platform/feature-flags">Feature Flags</Link>
                    </Button>
                    <Button asChild variant="ghost" className="justify-start">
                      <Link href="/settings/platform/health">System Health</Link>
                    </Button>
                    <Button asChild variant="ghost" className="justify-start">
                      <Link href="/settings/platform/errors">Error Logs</Link>
                    </Button>
                  </nav>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 lg:gap-6">
                {section.entities?.map(entityType => (
                  <EntityList key={entityType} entityType={entityType} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
