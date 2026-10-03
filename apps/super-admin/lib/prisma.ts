import { prisma } from '@novastar/database'

/**
 * The single database handle for the control plane.
 *
 * `@novastar/database` exposes one lazily-constructed `PrismaClient` and reads
 * `process.env.DATABASE_URL` at the moment of construction, not at import. The
 * alias below therefore has to run before the first query rather than before
 * the first import, which is why it lives in a module every reader must pass
 * through instead of in `next.config.ts` (a build-time process that a `next
 * start` server never re-enters for module side effects).
 *
 * What this buys: a deployment can point the dashboard at a connection string
 * whose PostgreSQL role has broader grants than the portal's, which is what plan
 * §11 risk 2 asks for. What it does not buy: a *separate role*. Creating one is
 * a migration, and migrations are outside this workspace. Until that migration
 * exists, `SUPER_ADMIN_DATABASE_URL` is an override of the connection string
 * only, and the README says so.
 */
if (process.env.SUPER_ADMIN_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SUPER_ADMIN_DATABASE_URL
}

export { prisma }

/**
 * Which environment variable the dashboard is actually connecting with. Surfaced
 * on the health page as a *name* only — never a value, because a connection
 * string is a credential.
 */
export function adminDatabaseSource(): 'SUPER_ADMIN_DATABASE_URL' | 'DATABASE_URL' | 'unset' {
  if (process.env.SUPER_ADMIN_DATABASE_URL) return 'SUPER_ADMIN_DATABASE_URL'
  if (process.env.DATABASE_URL) return 'DATABASE_URL'
  return 'unset'
}
