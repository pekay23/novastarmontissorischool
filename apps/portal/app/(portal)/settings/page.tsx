'use client'

import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent, Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '@novastar/shared-ui'
import { EntityType } from '@novastar/shared-types'
import { EntityList } from '@/components/config/entity-list'

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
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('academic')

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
        <TabsList className="grid w-full grid-cols-6">
          {SETTINGS_SECTIONS.map(section => (
            <TabsTrigger key={section.id} value={section.id} className="gap-2">
              <span>{section.icon}</span>
              <span>{section.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {SETTINGS_SECTIONS.map(section => (
          <TabsContent key={section.id} value={section.id} className="space-y-6">
            <div className="grid gap-4 lg:gap-6">
              {section.entities.map(entityType => (
                <EntityList key={entityType} entityType={entityType} />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
