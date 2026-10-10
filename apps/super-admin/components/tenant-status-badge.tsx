import { Badge } from '@novastar/shared-ui'

/**
 * Whether a tenant is serving traffic.
 *
 * Three states, not two, because `isActive` is a single boolean and the console
 * needs to distinguish "running", "switched off" and "switched off by us" — an
 * operator auditing why a school went offline needs the last one to read
 * differently from a school that has simply not been onboarded yet.
 */
export function TenantStatusBadge({
  isActive,
  suspendedAt,
}: {
  isActive: boolean
  suspendedAt?: string | null
}) {
  if (isActive) {
    return (
      <Badge variant="secondary" className="font-normal">
        Active
      </Badge>
    )
  }
  return (
    <Badge variant="destructive" className="font-normal">
      {suspendedAt ? 'Suspended' : 'Inactive'}
    </Badge>
  )
}
