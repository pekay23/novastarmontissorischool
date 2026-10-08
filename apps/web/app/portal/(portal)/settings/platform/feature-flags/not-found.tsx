import Link from 'next/link'

import { NotFound, notFoundActionClasses } from '@novastar/shared-ui'

export default function FeatureFlagsNotFound() {
  return (
    <NotFound
      label="404 · Feature Flags"
      description="The feature flags page you tried to access does not exist."
      action={
        <Link
          href="/settings/platform/feature-flags"
          className={notFoundActionClasses}
        >
          Back to Feature Flags
        </Link>
      }
    />
  )
}
