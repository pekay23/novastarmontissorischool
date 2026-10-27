import { hasPermission } from '@novastar/auth'
import { getTenantContext } from '@/lib/tenant'
import { StudentEditor } from '@/components/students/student-editor'
export const metadata = { title: 'Add student' }
export default async function NewStudentPage() {
  const { userId, tenantId, schoolId } = await getTenantContext()
  if (
    !schoolId ||
    !(await hasPermission(userId, 'student:create', tenantId, schoolId))
  )
    return <p role="alert">You do not have permission to add students.</p>
  return <StudentEditor />
}
