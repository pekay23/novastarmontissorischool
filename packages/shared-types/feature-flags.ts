/**
 * Feature flag keys and defaults that more than one app must agree on.
 *
 * WHY THESE LIVE HERE RATHER THAN IN ONE APP'S REGISTRY
 * -----------------------------------------------------
 * `admissions_open` has two independent readers. The portal writes it — through
 * `PATCH /api/admissions/status`, which owns the toggle — and the public site
 * reads it to decide whether to render the application form or a "closed for
 * intake" notice. Those are separate Next.js apps with separate bundles, and the
 * only thing joining them is a string in a `SystemConfig.key` column.
 *
 * If either side spelled the key its own way, nothing would fail. The portal
 * would happily write an `SystemConfig` row under a key the public site never
 * looks for, the site would fall back to its own hardcoded default, and the
 * school would have published "apply now" against a flag the Head of School
 * closed in the portal — with no error, no failed test, and no audit trail
 * pointing at the mismatch. A drifted literal is silent in both directions:
 * renamed on the write side it strands existing rows, renamed on the read side
 * it reads a column nobody writes. The type system cannot help either, because
 * `SystemConfig.key` is a plain `String` and `JSON` has no nominal types.
 *
 * So the one thing that genuinely must not drift is a literal, and a literal is
 * exactly what a shared constant is for. The portal still owns the registry —
 * `lib/system-config.ts` remains the source of truth for which flags exist, what
 * they default to and who may write them. This module shares only the two facts
 * whose absence on one side breaks the other: the key and the default.
 *
 * Declared `as const` so a computed property in the portal's registry still
 * yields a literal key type. Without it `ADMISSIONS_OPEN_FLAG_KEY` widens to
 * `string`, `[ADMISSIONS_OPEN_FLAG_KEY]` collapses the registry's key union, and
 * `FeatureFlagKey` stops being a union of real keys — the exact regression
 * `as const satisfies` in that registry exists to prevent.
 */

/** The `SystemConfig.key` under which admissions state is stored. */
export const ADMISSIONS_OPEN_FLAG_KEY = 'admissions_open' as const

/**
 * Fail-closed default: a tenant with no override row is not taking
 * applications. The public site reads this constant for its unreachable-database
 * fallback, so a site that cannot reach the database closes admissions rather
 * than publishing an invitation nobody authorised.
 */
export const ADMISSIONS_OPEN_DEFAULT = false as const