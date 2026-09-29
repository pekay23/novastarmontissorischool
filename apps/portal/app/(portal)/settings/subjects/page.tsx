import { EntityList } from '@/components/config/entity-list'

export default function SubjectsSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">Subjects</h1>
        <p className="text-muted-foreground">Manage all school subjects and their properties</p>
      </div>
      <EntityList entityType="subject" />
    </div>
  )
}
