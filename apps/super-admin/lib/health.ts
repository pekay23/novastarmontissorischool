import { adminDatabaseSource } from '@/lib/prisma'
import { countAppliedMigrations, countPlatformTotals } from '@/lib/queries'
import type { HealthCheck, PlatformHealth } from '@/types/admin'

/**
 * The platform health report.
 *
 * Every check is independent and every failure is caught. A health page that throws
 * on the first unreachable dependency shows an operator a stack trace instead of a
 * status, which is the opposite of what the page is for: it has to report a partial
 * outage accurately, and it has to do so without printing a connection string.
 *
 * So each check carries pre-written copy and never interpolates a value from the
 * environment or from a driver error. `detail` is a sentence this file chose, not a
 * message something else produced.
 */

const HEALTHY = 'healthy' as const
const UNAVAILABLE = 'unavailable' as const

export async function platformHealth(): Promise<PlatformHealth> {
  const checks: HealthCheck[] = []

  // --- Connection string -----------------------------------------------------
  const source = adminDatabaseSource()
  checks.push({
    id: 'database_configured',
    label: 'Database connection',
    // Reports the variable NAME only. The value is a credential with a host and a
    // password in it, and a health page is exactly the sort of thing that gets
    // screenshotted into a ticket.
    outcome: source === 'unset' ? UNAVAILABLE : HEALTHY,
    detail:
      source === 'unset'
        ? 'No connection string is configured. Set SUPER_ADMIN_DATABASE_URL or DATABASE_URL.'
        : `Connecting with ${source}.`,
  })

  // --- Reachable -------------------------------------------------------------
  const totals = await attempt(() => countPlatformTotals())
  checks.push(
    totals.ok
      ? {
          id: 'database_reachable',
          label: 'Primary database',
          outcome: HEALTHY,
          detail: `${totals.value.tenants} tenants, ${totals.value.schools} schools, ${totals.value.users} users.`,
        }
      : {
          id: 'database_reachable',
          label: 'Primary database',
          outcome: UNAVAILABLE,
          detail: 'The primary database did not answer. Counts are unavailable.',
        },
  )

  // --- Migrations ------------------------------------------------------------
  const migrations = await attempt(() => countAppliedMigrations())
  checks.push(
    migrations.ok && migrations.value !== null
      ? {
          id: 'migrations',
          label: 'Schema migrations',
          outcome: HEALTHY,
          detail: `${migrations.value} migrations have been applied.`,
        }
      : {
          id: 'migrations',
          label: 'Schema migrations',
          outcome: UNAVAILABLE,
          detail: 'The migration history table is not readable from this connection.',
        },
  )

  // --- Mirror ----------------------------------------------------------------
  const mirrorConfigured = Boolean(process.env.SUPABASE_DATABASE_URL)
  checks.push({
    id: 'mirror_configured',
    label: 'Read replica (Supabase)',
    outcome: mirrorConfigured ? HEALTHY : UNAVAILABLE,
    detail: mirrorConfigured
      ? 'SUPABASE_DATABASE_URL is set. Freshness is not measured: this app holds one connection, not two.'
      : 'SUPABASE_DATABASE_URL is not set, so there is no replica to mirror to.',
  })

  return {
    generatedAt: new Date().toISOString(),
    checks,
    totals: totals.ok
      ? totals.value
      : { tenants: 0, activeTenants: 0, schools: 0, users: 0, auditEntries: 0 },
    databaseSource: source,
  }
}

type Attempt<T> = { ok: true; value: T } | { ok: false }

/**
 * Runs a check and converts a throw into a failed result.
 *
 * The error is logged server-side and dropped: it is logged so an operator has a
 * line to correlate, and dropped so the response cannot carry it. A Neon's
 * connection error names the host it could not reach.
 */
async function attempt<T>(fn: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    console.error('[super-admin] Health check failed:', error instanceof Error ? error.message : error)
    return { ok: false }
  }
}
