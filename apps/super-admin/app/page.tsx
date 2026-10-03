import { redirect } from 'next/navigation'

/**
 * `/` redirects to `/tenants`.
 *
 * Deliberately not the platform overview. The build plan lists both
 * `app/page.tsx` ("redirect -> /tenants") and `app/(dashboard)/page.tsx`
 * ("platform overview"), which cannot both exist: a route group does not change a
 * path, so both resolve to `/` and Next.js refuses the build with two parallel
 * pages on one route. This file keeps the plan's literal behaviour for `/` and the
 * overview moved to `/overview`, which is the only way both survive.
 */
export default function RootPage(): never {
  redirect('/tenants')
}
