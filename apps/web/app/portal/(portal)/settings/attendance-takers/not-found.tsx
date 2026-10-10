import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function AttendanceTakersNotFound() {
  return (
    <NotFound
      label="404 · Attendance Takers"
      description="The attendance taker grant matrix you tried to access does not exist."
      action={
        <Link
          href="/portal/settings/attendance-takers"
          className={notFoundActionClasses}
        >
          Back to Attendance Takers
        </Link>
      }
    />
  )
}
