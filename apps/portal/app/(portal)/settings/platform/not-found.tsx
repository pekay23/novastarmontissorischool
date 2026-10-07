import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function PlatformNotFound() {
  return (
    <NotFound
      label="404 · Platform Settings"
      description="The platform configuration page you tried to access does not exist."
      action={
        <Link href="/settings/platform" className={notFoundActionClasses}>
          Back to Platform Settings
        </Link>
      }
    />
  )
}
