import { EntityList } from '@/components/config/entity-list'

export default function RolesSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">User Roles & Permissions</h1>
        <p className="text-muted-foreground">
          Define user roles and their permissions. Admins can delegate access to
          different parts of the system to different staff members.
        </p>
      </div>
      <EntityList entityType="role" />
    </div>
  )
}
