import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function SyllabusNotFound() {
  return (
    <NotFound
      label="404 · Syllabus"
      description="The syllabus page you tried to access does not exist."
      action={
        <Link href="/dashboard" className={notFoundActionClasses}>
          Back to Dashboard
        </Link>
      }
    />
  )
}
