import { Badge } from '@novastar/shared-ui'
import type { HealthCheck } from '@/types/admin'

/**
 * The health checks.
 *
 * `detail` is rendered as written. Every string on this component comes from
 * `lib/health.ts`, which builds it from names and counts — never from a driver
 * error and never from an environment value. That is what keeps a connection
 * string out of a page an operator screenshots into a support ticket.
 */
export function HealthChecks({ checks }: { checks: readonly HealthCheck[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {checks.map((check) => (
        <li key={check.id} className="rounded-md border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{check.label}</span>
            <Badge
              variant={check.outcome === 'healthy' ? 'secondary' : 'destructive'}
              className="font-normal"
            >
              {check.outcome}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{check.detail}</p>
        </li>
      ))}
    </ul>
  )
}
