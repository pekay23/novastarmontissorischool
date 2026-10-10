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
    // The register, and the only section that makes the amendment prompt
    // reachable.
    //
    // `Student.finalizedAt` and `Parent.finalizedAt` are the ONLY two lock columns
    // the lock migration adds to entities this registry manages (the other two are
    // on the attendance tables, which have no registry entry), so `student` and
    // `parent` are the only rows that can ever be reason-gated. Exposing them here
    // through the ordinary `EntityList` — rather than a second edit screen — is
    // what puts the prompt in front of a user at all, and it reuses the shared
    // form instead of duplicating it.
    //
    // Flagged, because it is a second place to edit the register alongside
    // /students and /parents: those pages have fuller forms. That duplication is
    // pre-existing — both entries already had `allowEdit: true` and were simply
    // unreachable — and the alternative was shipping a prompt that can never fire.
    // Reconciling the two surfaces is the real fix and is out of scope here.
    id: 'register',
    label: 'Register',
    icon: '📒',
    entities: ['student', 'parent'] as EntityType[],
  },
  {
    id: 'branding',
    label: 'School Branding',
    icon: '🎨',
    entities: ['branding'] as EntityType[],
  },
  {
    // Its own section rather than another link in the Platform tab: that tab is
    // described as "Head of School configuration for system-level settings" and
    // its three pages all refuse every role but the Head of School, so an
    // admissions switch filed there would read as a platform setting and would
    // be missed by exactly the people who are allowed to use it.
    id: 'admissions',
    label: 'Admissions',
    icon: '🚪',
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
            ) : section.id === 'admissions' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Admissions</CardTitle>
                  <CardDescription>
                    Whether the school is accepting applications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <nav className="flex flex-col gap-2">
                    <Button asChild variant="ghost" className="justify-start">
                      <Link href="/settings/admissions">Admissions Status</Link>
                    </Button>
                  </nav>
                </CardContent>
              </Card>
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
