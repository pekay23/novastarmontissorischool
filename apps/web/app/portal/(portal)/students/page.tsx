import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { StudentDirectory } from '@/components/students/student-directory'

export default async function StudentsPage() {
  const { userId, tenantId, schoolId } = await getTenantContext()
  if (!schoolId)
    return <p role="alert">No school is assigned to your account.</p>
  const [canRead, canCreate, canEdit, canDelete] = await Promise.all(
    ['student:read', 'student:create', 'student:edit', 'student:delete'].map(
      (permission) => hasPermission(userId, permission, tenantId, schoolId),
    ),
  )
  if (!canRead)
    return <p role="alert">You do not have permission to view students.</p>
  return (
    <StudentDirectory
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  )
}
