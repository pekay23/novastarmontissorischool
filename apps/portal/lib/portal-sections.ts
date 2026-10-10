/**
 * Role-based reachability: the one list of what a role may open.
 *
 * Two places need this answer and must not answer it differently. The proxy
 * (`proxy.ts`) refuses a request the role may not make; the portal layout
 * (`app/(portal)/layout.tsx`) offers a link to a page the role may not open. They
 * used to keep separate copies — a `PERMISSIONS` map and a `SETTINGS_ROLES` set
 * plus an unconditional `return true` — which produced two failures at once:
 *
 * - The sidebar showed all sixteen sections to every role and hid only Settings,
 *   so a `CLASSROOM_TEACHER` opened four of them and was bounced from twelve, and
 *   `ASSISTANT_HEAD` was shown a Settings link the proxy always refused.
 * - A section named in the map could still be unreachable, because the map names
 *   first path segments and a page's data routes are not under the page's name.
 *   `ACCOUNTANT` was granted `fees` and `payments`; the finance API is
 *   `/api/finance/**`, so every fetch the Fees page made was redirected to
 *   `/dashboard/unauthorized` before the handler's own `finance:read` check could
 *   answer. The authorization model was right; only this list was wrong.
 *
 * So both consumers read this module, and `decidePortalPath` is the single
 * function that decides. A link the sidebar renders is by construction a path the
 * proxy admits; the test in `tests/portal-reachability.test.ts` executes both
 * halves so the two cannot drift apart again.
 *
 * ## What this is and is not
 *
 * This is the *coarse* filter. It answers "is this role a portal role at all, and
 * is this section one of its sections" — nothing finer. Whether the caller may
 * read this particular invoice, or only their own children's, is decided by the
 * route handler through `hasPermission` and `resolveVisibility`, and stays there.
 * That division is why a missing entry is a *denial* and not a bypass: the handler
 * behind it is what grants access, and this layer only stops the request from
 * reaching it.
 *
 * A section named here must therefore be one this role actually has a use for.
 * `tests/portal-reachability.test.ts` fails on a segment that matches no page and
 * no API resource, because an entry that grants nothing — `payments` named no
 * route at all — reads like a grant and hides the sections that do.
 *
 * Four entries were corrected when this moved out of `proxy.ts`, each checked
 * against the route that answers the path and the grant rule that gates it:
 *
 * | Role | Change | Why |
 * | --- | --- | --- |
 * | `ACCOUNTANT` | + `finance` | The finance API is `/api/finance/**`. `fees` and `payments` name no such route, so every fetch the Fees page made was redirected to `/dashboard/unauthorized` ahead of its own `finance:read` check. |
 * | `ACCOUNTANT` | − `students` | `ROLE_GRANT_RULES.ACCOUNTANT` is `finance` and `reports`, so it holds no `student:*` key; `/api/students` refused it anyway. Invoices show student names through a server-side join. |
 * | `HEAD_TEACHER` | − `reports` | `report:read` is in the `reports` category, which that role's rule (`academic`, `student`, `communication`) does not reach, so the report request 403'd behind an admitted page. |
 * | `ASSISTANT_HEAD` | − `inventory` | `inventory:*` is in the `system` category, which that role's rule (`category !== 'system'`) excludes. |
 *
 * The mirror-image gaps — sections a role *does* hold a permission behind but was
 * never granted, such as `teachers` and `timetable` for `ASSISTANT_HEAD` — are
 * deliberately not closed here. Widening what a role reaches is an authorization
 * decision about `ROLE_GRANT_RULES`, not a reachability fix, and it belongs with
 * that table rather than in a list that would then have to be re-derived from it.
 */

/**
 * The first path segment a role may reach, per role.
 *
 * Keys are the DB `Role.name` values from tools/seed/index.ts: HEADMASTER,
 * ASSISTANT_HEAD, HEAD_TEACHER, CLASSROOM_TEACHER, ACCOUNTANT, ADMIN_STAFF,
 * PARENT, ADMISSIONS_OFFICER. A key absent from this record is not a portal role,
 * and is answered with `unknown-role` — deny by default, including for a role
 * named `admin` or `super_admin`, which the seed never assigns.
 *
 * `'*'` is total reach and short-circuits before anything else, so HEADMASTER is
 * unaffected by any section added here.
 *
 * Two segments matter more than the rest, because they are the ones the previous
 * revision got backwards:
 *
 * - `finance` sits alongside `fees`. `fees` is the page, `finance` is the API the
 *   page fetches, and the proxy compares the first segment of each independently.
 *   Granting only `fees` admitted the page and refused every request it made.
 * - `students` is deliberately absent for `ACCOUNTANT`, which holds no `student:*`
 *   key at all: `ROLE_GRANT_RULES.ACCOUNTANT` is `finance` and `reports`. The
 *   invoice list shows student names through a server-side join, so it never
 *   needed the roster endpoint.
 */
export const PORTAL_SECTIONS_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  HEADMASTER: ['*'], // All portal access
  ASSISTANT_HEAD: [
    'dashboard', 'students', 'grades', 'attendance', 'announcements',
    'reports', 'fees', 'calendar', 'library',
  ],
  HEAD_TEACHER: [
    'dashboard', 'students', 'grades', 'attendance', 'announcements',
  ],
  CLASSROOM_TEACHER: [
    'dashboard', 'students', 'grades', 'attendance', 'classes',
  ],
  ACCOUNTANT: ['dashboard', 'fees', 'finance', 'reports'],
  // No `students_view` entry: section matching is `section === p ||
  // section.startsWith(p)` against the first path segment, so `'students_view'`
  // could never match `'students'` and sat in the list as a dead entry while
  // ADMIN_STAFF was actually denied `/api/students` — a role PARENT was allowed.
  // Nor `'settings'`, which would hand the whole settings section to every admin
  // staffer; the admissions surface it needs is exempted by prefix below.
  ADMIN_STAFF: ['dashboard', 'announcements'],
  PARENT: ['dashboard', 'announcements', 'students'],
  // Absent from this map until now, which meant `perms` was `undefined` and the
  // role was redirected to `/login` for every path — the admissions pages and API
  // it exists to serve included. `students` because an application becomes a
  // student record; `announcements` because intake notices go out the same way as
  // any other school communication.
  ADMISSIONS_OFFICER: ['dashboard', 'students', 'announcements'],
}

/**
 * Paths outside a role's section list that the role may still reach.
 *
 * The section match compares only the first path segment, so admitting
 * `/settings/admissions` would mean admitting all of `/settings`. These are
 * exact prefixes for exactly that reason: each entry is a surface whose own
 * server-side gate is the real authorisation, and this layer exists so the
 * request reaches that gate rather than bouncing off the proxy.
 */
export const PATH_EXEMPT_PREFIXES_BY_ROLE: Readonly<Record<string, readonly string[]>> = {
  ADMIN_STAFF: ['/settings/admissions', '/api/admissions'],
  ADMISSIONS_OFFICER: ['/settings/admissions', '/api/admissions'],
}

/**
 * What the proxy does with a path.
 *
 * `unknown-role` is a distinct outcome from `denied` because it answers a
 * different question and sends the caller somewhere different: a role that is not
 * in the map has no business in the portal at all, so the proxy sends it to
 * `/login`, while a portal role asking for a section it does not hold is sent to
 * `/dashboard/unauthorized`. Collapsing the two would either strand a
 * mis-provisioned account in a loop or tell it it had merely opened the wrong
 * page.
 */
export type PortalPathDecision =
  | { readonly outcome: 'allow' }
  | { readonly outcome: 'denied' }
  | { readonly outcome: 'unknown-role' }

/**
 * The first path segment a request is authorised against.
 *
 * `/api/<resource>/…` is matched on `<resource>` and `/<section>/…` on
 * `<section>`, which is why a page and the API it fetches can need two separate
 * entries: `/fees` and `/api/finance` share nothing but a purpose.
 */
function firstSegment(pathname: string): string {
  const segments = pathname.startsWith('/api/')
    ? pathname.split('/').slice(2).filter(Boolean) // /api/<resource> → [resource]
    : pathname.split('/').filter(Boolean) // /<section>/... → [section, ...]
  return segments[0] ?? ''
}

/**
 * Decide one path for one role. The whole of the proxy's role gate.
 *
 * The order is the proxy's order and is load-bearing: `'*'` is checked before the
 * exempt prefixes so total access cannot be narrowed by them, and the unknown-role
 * answer is decided before either so a role outside the map never reaches a
 * comparison against a list that has nothing to say about it.
 */
export function decidePortalPath(
  role: string | null | undefined,
  pathname: string,
): PortalPathDecision {
  if (role == null) return { outcome: 'unknown-role' }

  const sections = PORTAL_SECTIONS_BY_ROLE[role]
  if (!sections) return { outcome: 'unknown-role' }

  if (sections.includes('*')) return { outcome: 'allow' }

  const exempt = PATH_EXEMPT_PREFIXES_BY_ROLE[role]
  if (exempt?.some((prefix) => pathname.startsWith(prefix))) return { outcome: 'allow' }

  const section = firstSegment(pathname)
  const held = sections.some((p) => section === p || section.startsWith(p))
  return held ? { outcome: 'allow' } : { outcome: 'denied' }
}

/**
 * Narrow a navigation list to the entries this role may actually open.
 *
 * Takes the items rather than the role alone so the sidebar cannot forget to
 * apply it: the same call shapes what the proxy decides, so the list it returns is
 * a subset of what the proxy admits by construction rather than by review.
 *
 * Deny by default, because `decidePortalPath` does: an absent role, an absent
 * permission set, or a section nobody holds all render no link at all. There is
 * then nothing to click into a redirect, and nothing a user can mistake for a
 * page they are allowed to open.
 */
export function reachableNavigation<T extends { href: string }>(
  role: string | null | undefined,
  items: readonly T[],
): T[] {
  return items.filter((item) => decidePortalPath(role, item.href).outcome === 'allow')
}