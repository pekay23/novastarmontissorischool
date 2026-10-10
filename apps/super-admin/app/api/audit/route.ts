import { requireCapability } from '@/lib/admin-context'
import { toErrorResponse } from '@/lib/errors'
import { json, parsePagination } from '@/lib/http'
import { auditAcrossPlatform } from '@/lib/queries'

/**
 * `GET /api/audit` — the cross-tenant audit trail.
 *
 * Requires `platform:audit`. The query behind it is deliberately cross-tenant: the
 * point of a platform audit page is to see what happened anywhere, and a
 * per-tenant filter would defeat it. `auditForTenant` is the scoped counterpart
 * for a drill-down.
 *
 * Entries belonging to a suspended tenant are withheld, and the response says how
 * many in `meta.excludedSuspendedEntries` — additive, so a client reading `data` or
 * `meta.total` is unaffected. `lib/queries.ts` documents why this one withholds
 * where `auditForTenant` refuses.
 *
 * Both windows read the same `AUDIT_SELECT` projection, so the two views cannot
 * disagree about what a row contains — and neither carries `oldData` or
 * `newData`, which are unvalidated JSON written by many callers and are not
 * something an operator needs in order to read a trail.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requireCapability('platform:audit')
    return json(await auditAcrossPlatform(parsePagination(request.url)))
  } catch (error) {
    return toErrorResponse(error)
  }
}
