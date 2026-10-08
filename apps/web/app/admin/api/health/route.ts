import { requireCapability } from '@/lib/admin-context'
import { toErrorResponse } from '@/lib/errors'
import { platformHealth } from '@/lib/health'
import { json } from '@/lib/http'

/**
 * `GET /api/health` — platform health.
 *
 * The same shape the health page renders, so a monitor and an operator read the
 * same thing. Requires `platform:read`: an unauthenticated caller must not be able
 * to tell a healthy deployment from an unreachable database by polling this URL.
 *
 * Deliberately not a public liveness endpoint. The portal's `/api/system/health`
 * is tenant-scoped; this one is fleet-wide, so it sits behind the operator gate
 * like every other page in this app.
 *
 * Never degraded-by-design into a 200. A health check that answers 200 while the
 * database is unreachable is a health check that has stopped working, which is the
 * failure it exists to catch.
 */
export async function GET(): Promise<Response> {
  try {
    await requireCapability('platform:read')
    const health = await platformHealth()
    // 200 for healthy, 503 for a failed check. A monitor that only looks at the
    // status code should still see the outage.
    const failed = health.checks.some((check) => check.outcome === 'unavailable')
    return json(health, failed ? 503 : 200)
  } catch (error) {
    return toErrorResponse(error)
  }
}
