import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

/**
 * Reached when the promotions route is addressed with a segment that is not
 * this screen — there is no per-promotion detail view, because a promotion
 * is a command, not a record: its history lives in `Enrollment`, one row per
 * student per term.
 */
export default function PromotionsNotFound() {
  return (
    <NotFound
      label="404 · Promotions"
      description="The promotions page you tried to access does not exist."
      action={
        <Link href="/dashboard" className={notFoundActionClasses}>
          Back to Dashboard
        </Link>
      }
    />
  )
}
