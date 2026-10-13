import { prisma } from '@novastar/database'

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
