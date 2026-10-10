import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export const metadata = {
  title: 'Page not found — Novastar Platform Console',
  description: 'The page you are looking for could not be found.',
  robots: { index: false, follow: false },
}

/**
 * Root 404 for the super-admin console.
 *
 * The control plane never needs to be indexed, so `robots` is noindex.
 * The console runs under `basePath: '/admin'`, so the action link uses
 * `next/link` to pick up the prefix automatically.
 */
export default function SuperAdminNotFound() {
  return (
    <NotFound
      label="404"
      description="The page you are looking for could not be found or you do not have permission to view it."
      action={
        <Link href="/" className={notFoundActionClasses}>
          Back to Overview
        </Link>
      }
    />
  )
}
