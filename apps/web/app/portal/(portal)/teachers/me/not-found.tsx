import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function TeacherWorkspaceNotFound() {
  return (
    <NotFound
      label="404 · My Workspace"
      description="The teacher workspace you tried to access does not exist."
      action={
        <Link href="/portal/teachers" className={notFoundActionClasses}>
          Back to Teachers
        </Link>
      }
    />
  )
}
