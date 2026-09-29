import { EntityList } from '@/components/config/entity-list'

export default function SchoolSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">School Settings</h1>
        <p className="text-muted-foreground">Manage school branding, contact info, and visual identity</p>
      </div>
      <EntityList entityType="branding" />
    </div>
  )
}
