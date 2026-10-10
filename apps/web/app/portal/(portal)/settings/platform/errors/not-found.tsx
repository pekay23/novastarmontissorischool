import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function SystemErrorsNotFound() {
  return (
    <NotFound
      label="404 · System Errors"
      description="The system errors page you tried to access does not exist."
      action={
        <Link
          href="/portal/settings/platform/errors"
          className={notFoundActionClasses}
        >
          Back to System Errors
        </Link>
      }
    />
  )
}
