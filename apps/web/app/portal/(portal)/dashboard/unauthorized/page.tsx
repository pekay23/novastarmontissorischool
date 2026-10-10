import { Button } from '@novastar/shared-ui'
import Link from 'next/link'

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <h1 className="font-heading text-4xl font-bold text-destructive mb-4">403</h1>
      <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        You do not have permission to access this page. Contact your administrator
        if you believe this is an error.
      </p>
      <Link href="/portal/dashboard">
        <Button>Return to Dashboard</Button>
      </Link>
    </div>
  )
}
