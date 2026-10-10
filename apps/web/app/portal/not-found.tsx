import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export const metadata = {
  title: 'Page not found',
  description: 'The page you are looking for could not be found.',
}

/**
 * Root 404 for the portal, rendered by `app/layout.tsx` when no route matches.
 *
 * The shared `NotFound` supplies the layout and copy; this file supplies the
 * link. The portal runs under `basePath: '/portal'`, so navigation must go
 * through `next/link` — a plain `<a href="/portal/dashboard">` would drop the
 * `/portal` prefix and 404 a second time.
 */
export default function PortalNotFound() {
  return (
    <NotFound
      label="404"
      description="The page you are looking for could not be found or you do not have permission to view it."
      action={
        <Link href="/portal/dashboard" className={notFoundActionClasses}>
          Back to Dashboard
        </Link>
      }
    />
  )
}
