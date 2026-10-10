import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function HealthNotFound() {
  return (
    <NotFound
      label="404 · System Health"
      description="The system health page you tried to access does not exist."
      action={
        <Link
          href="/portal/settings/platform/health"
          className={notFoundActionClasses}
        >
          Back to System Health
        </Link>
      }
    />
  )
}
