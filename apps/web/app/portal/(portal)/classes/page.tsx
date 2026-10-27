import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { ClassManager } from '@/components/classes/class-manager'

export const metadata = { title: 'Classes' }

export default async function ClassesPage() {
  const { userId, tenantId, schoolId } = await getTenantContext()
  if (!schoolId)
    return <p role="alert">No school is assigned to your account.</p>
  const [canRead, canCreate, canEdit, canDelete] = await Promise.all(
    ['class:read', 'class:create', 'class:edit', 'class:delete'].map(
      (permission) => hasPermission(userId, permission, tenantId, schoolId),
    ),
  )
  if (!canRead)
    return <p role="alert">You do not have permission to view classes.</p>
  return (
    <ClassManager
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  )
}
