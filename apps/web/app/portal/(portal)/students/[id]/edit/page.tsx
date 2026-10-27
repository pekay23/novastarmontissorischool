import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { StudentEditor } from '@/components/students/student-editor'
export const metadata = { title: 'Edit student' }
export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { userId, tenantId, schoolId } = await getTenantContext()
  if (
    !schoolId ||
    !(await hasPermission(userId, 'student:edit', tenantId, schoolId))
  )
    return <p role="alert">You do not have permission to edit students.</p>
  return <StudentEditor id={id} />
}
