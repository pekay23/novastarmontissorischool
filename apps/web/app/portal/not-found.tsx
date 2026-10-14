'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { NotFound, notFoundActionClasses, Button } from '@novastar/shared-ui'

export default function PortalNotFound() {
  const router = useRouter()
  const handleGoBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/portal/dashboard')
    }
  }
  return (
    <NotFound
      label="404"
      description="The page you are looking for could not be found or you do not have permission to view it."
      action={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleGoBack}>
            Go Back
          </Button>
          <Link href="/portal/dashboard" className={notFoundActionClasses}>
            Back to Dashboard
          </Link>
        </div>
      }
    />
  )
}
