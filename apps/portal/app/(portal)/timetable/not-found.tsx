import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function TimetableNotFound() {
  return (
    <NotFound
      label="404 · Timetable"
      description="The timetable page you tried to access does not exist."
      action={
        <Link href="/dashboard" className={notFoundActionClasses}>
          Back to Dashboard
        </Link>
      }
    />
  )
}
