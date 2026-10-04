/**
 * Credential resolution for the database seed.
 *
 * This module exists, as a separate file with no Prisma import, for one reason:
 * the refusal has to be provable without a database. The seed provisions two
 * accounts that hold every permission in the system, so "which password does it
 * install" is the single question this file answers, and a question whose answer
 * can only be observed by seeding a real database is a question nobody can test.
 *
 * ## The defect this replaces
 *
 * The seed used to read `SEED_HEADMASTER_PASSWORD`, warn when it was absent, and
 * then hash a literal committed to this repository (`Novastar2026!` /
 * `Admin@2026`). The warning read as "you forgot to set it" — but the operator
 * had set it. `turbo.json`'s `globalEnv` listed `TENANT_ADMIN_PASSWORD` and not
 * these two, so `turbo run db:seed` filtered them straight out of the task's
 * environment and the seed silently used the published password instead. The
 * observable result was a school's administrator account whose credential is in
 * git, reachable by anyone who has read the repository.
 *
 * ## The rule now
 *
 * **A missing required variable refuses the seed. There is no default.** Same
 * shape as `PlatformOperator`'s empty `capabilities` array: a grant list is an
 * authorisation decision, so an absent one is a refusal rather than an empty
 * grant. Nobody is handed an account they did not choose the password for.
 *
 * The committed literals have not been deleted, because `verify-admin.ts` knows
 * how to verify them and because deleting them is a separate decision from
 * refusing to install them. They are reachable only through
 * `SEED_ALLOW_DEFAULT_PASSWORDS=1` AND a **local** database host — two locks,
 * both of which must open, exactly as `tools/migrate`'s `reset` requires both
 * `--dev-only` and a local address. A flag alone would leave a published
 * administrator password one `.env` entry away from production; the second lock
 * is what makes these literals test fixtures rather than credentials.
 *
 * ## The second lock cannot open, and that is the invariant, not a bug
 *
 * It reads as protection and, against the only database this project can
 * actually serve, it is inert. `.env.example:22-27` records why: the Prisma
 * client is built with `@prisma/adapter-neon`, which speaks Neon's SQL-over-HTTP
 * protocol and NOT the PostgreSQL wire protocol. A `postgres:16` container on
 * tcp/5432 therefore cannot serve this schema through that adapter at all, so
 * there is no local host this project can point `DATABASE_URL` at and seed
 * successfully. The only usable database is Neon, whose hosts are remote by
 * definition and can never satisfy `isLocalHost`. The two locks can never both
 * be true, so `Novastar2026!` and `Admin@2026` are unreachable — permanently,
 * not accidentally. That is the outcome the lock was written to produce, reached
 * by a property of the driver rather than by anyone's discipline; the literals
 * survive as greppable dead code so the shape outlives them.
 *
 * Stating it plainly matters more than the branch is worth. A lock whose gate
 * cannot open reads as a safety mechanism to everyone who reads it and as a
 * dead branch to nobody, so the next person to touch this file will preserve a
 * guarantee that does not exist. What would make it meaningful again, best
 * first:
 *
 *   1. Delete the literals and the opt-in. Then there is nothing to gate, no
 *      inert branch, and `verify-admin.ts` reads variables like every other
 *      credential check in the repository. Preferred end state.
 *   2. Support a local engine — a second datasource with `@prisma/adapter-pg`
 *      beside the Neon one — so `localhost` becomes genuinely seedable. Only
 *      then does `isLocalHost` admit a host that exists.
 *   3. Never by relaxing the host gate. Dropping it would publish two
 *      administrator passwords; nothing in this repository should do that.
 *
 * The environment is a parameter, not a global read, so `tests/` never has to
 * mutate `process.env`.
 */

/** Names the operator chooses; both must be non-blank or the seed refuses. */
export const HEADMASTER_PASSWORD_VAR = 'SEED_HEADMASTER_PASSWORD'
export const PORTAL_ADMIN_PASSWORD_VAR = 'SEED_PORTAL_ADMIN_PASSWORD'

/**
 * The opt-in for the committed fallbacks, local databases only.
 *
 * `SEED_`-prefixed to match the two variables it guards, and `=1` to match
 * `MIGRATE_SKIP_DOTENV` and `SKIP_PRODUCTION_GUARD`, the repository's existing
 * spelling for "a person turned this on deliberately".
 *
 * This gate cannot currently open: on a Neon-only deployment there is no local
 * host for the host half of the pair to admit, so the fallbacks stay unreachable
 * however deliberately this is set. See the module comment — the invariant is
 * that the defaults are dead, and this is why. It is kept, and kept shut, because
 * a lock that is gone cannot be re-closed if the adapter ever changes.
 */
export const ALLOW_DEFAULT_PASSWORDS_VAR = 'SEED_ALLOW_DEFAULT_PASSWORDS'

/**
 * The committed fallbacks. Published by construction — see the module comment.
 * Kept as named exports so a test can assert the refusal does not hand them out,
 * and so the literals are greppable rather than buried at a call site.
 *
 * They are unreachable: the opt-in above cannot open on a Neon-only deployment,
 * because no local host can serve a schema through `@prisma/adapter-neon`. These
 * names document the shape of the escape hatch and nothing more.
 */
export const DEFAULT_HEADMASTER_PASSWORD = 'Novastar2026!'
export const DEFAULT_PORTAL_ADMIN_PASSWORD = 'Admin@2026'

export interface SeedCredentials {
  readonly headmasterPassword: string
  readonly portalAdminPassword: string
  /** Which variable supplied each, for the log line. Never the value itself. */
  readonly headmasterSource: string
  readonly portalAdminSource: string
  /**
   * True when at least one password came from a committed literal rather than
   * from the environment. The caller logs this loudly; it is the difference
   * between "this database is only as private as the person who set it" and
   * "this database is exactly as private as git is".
   */
  readonly usingCommittedDefaults: boolean
}

/** Thrown when a required password variable is absent. Carries every name. */
export class SeedCredentialsError extends Error {
  constructor(
    readonly variables: string[],
    message: string,
  ) {
    super(message)
    this.name = 'SeedCredentialsError'
  }
}

/** Reads a non-empty variable, or undefined. Blank and whitespace count as unset. */
function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]
  return value !== undefined && value.trim() !== '' ? value : undefined
}

/**
 * The host of a connection string, or undefined. Never throws: a malformed URL is
 * not the seed's problem to diagnose, and reporting it here would bury the real
 * message behind a parse error.
 */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/**
 * Addresses that are unambiguously a developer's own machine.
 *
 * Deliberately narrow, and asymmetric in the safe direction: an unrecognised host
 * is not local, so the second lock stays shut. Same rule and same reasoning as
 * `isLocalHost` in `tools/migrate/env.ts`, re-implemented rather than imported —
 * `tools/seed` has no package.json of its own, resolves against the repo root,
 * and is meant to stay runnable on its own. Ten lines of duplication is a better
 * trade than a dependency from the seed into another tool's internals.
 *
 * (Which is also why this function currently admits nothing usable: the Prisma
 * client speaks SQL-over-HTTP, so no local PostgreSQL server can be the seed's
 * target. The rule is right and the input is empty. See the module comment.)
 */
function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h === '0.0.0.0') return true
  if (h === 'host.docker.internal') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
}

/**
 * The refusal text. Every missing variable is named, and the routes to a seed
 * that succeeds are spelled out, because the operator who hits this on a clean
 * checkout has no `.env` entry to read and a bare "missing variable" sends them
 * looking through a file that does not exist yet.
 *
 * The opt-in is named and then immediately withdrawn: an operator who knows the
 * variable exists will try it, and a refusal that offered no explanation of why
 * it did not work would send them to the shell instead of to the fix. Stating
 * that the pair cannot open on a Neon-only deployment costs three lines and
 * saves the round trip.
 *
 * The host is included even when the opt-in is irrelevant, because the most
 * common way to be standing here is having exported the passwords correctly and
 * been surprised — and the answer to "why was my value ignored" is usually that
 * it was never ignored, it was stripped upstream by `turbo`.
 */
function refusalMessage(missing: string[], env: NodeJS.ProcessEnv): string {
  const named = missing.join(', ')
  const host = hostOf(read(env, 'DATABASE_URL') ?? read(env, 'DIRECT_URL'))
  const lines = [
    `Seed refused: ${named} ${missing.length === 1 ? 'is' : 'are'} not set.`,
    '',
    'This seed provisions two accounts that hold every permission in the system,',
    'and it will not invent their passwords. A default that ships in a committed',
    'file is a public credential: with these variables stripped from the task',
    'environment by turbo, an operator who exported a strong password was served',
    'the published one anyway.',
    '',
    'Set the password (no stack trace, no default, nothing is written):',
  ]
  for (const name of missing) {
    lines.push(`    export ${name}='<a strong password only you know>'`)
  }
  lines.push('')
  lines.push('Local development only: set')
  lines.push(`    ${ALLOW_DEFAULT_PASSWORDS_VAR}=1`)
  lines.push('to use the committed fallbacks. Both locks must open — that variable AND')
  lines.push('a local DATABASE_URL host.')
  lines.push('')
  lines.push('On this project that pair cannot open. The Prisma client speaks Neon\'s')
  lines.push('SQL-over-HTTP protocol, not the PostgreSQL wire protocol, so no local')
  lines.push('PostgreSQL server can serve this schema and the committed fallbacks are')
  lines.push('unreachable. Setting the password variables above is the way in.')
  if (host) {
    lines.push(
      `The target host is "${host}", which is ${
        isLocalHost(host) ? 'local, so the opt-in would work here' : 'NOT local, so the opt-in would not help here'
      }.`,
    )
  } else {
    lines.push('No DATABASE_URL was resolvable, so no host can be treated as local.')
  }
  lines.push('')
  lines.push('Nothing was written.')
  return lines.join('\n')
}

/**
 * Resolves both portal passwords or throws. Call this before anything else in
 * the seed — the whole point of a refusal is that nothing precedes it.
 *
 * `DATABASE_URL` and `DIRECT_URL` are read only to decide whether the local-only
 * opt-in may open. They are not this function's to validate; the seed already
 * refuses a missing connection string before `main()` runs.
 */
export function resolveSeedCredentials(env: NodeJS.ProcessEnv = process.env): SeedCredentials {
  const headmaster = read(env, HEADMASTER_PASSWORD_VAR)
  const portalAdmin = read(env, PORTAL_ADMIN_PASSWORD_VAR)

  if (headmaster && portalAdmin) {
    return {
      headmasterPassword: headmaster,
      portalAdminPassword: portalAdmin,
      headmasterSource: HEADMASTER_PASSWORD_VAR,
      portalAdminSource: PORTAL_ADMIN_PASSWORD_VAR,
      usingCommittedDefaults: false,
    }
  }

  const missing = [
    ...(headmaster ? [] : [HEADMASTER_PASSWORD_VAR]),
    ...(portalAdmin ? [] : [PORTAL_ADMIN_PASSWORD_VAR]),
  ]

  // Two locks, both required. `env[VAR] === '1'` exactly, matching the
  // repository's other escape hatches: an unset variable, `0`, `true` and `yes`
  // all leave the lock shut, so nothing about this is inferable.
  const optIn = env[ALLOW_DEFAULT_PASSWORDS_VAR] === '1'
  const host = hostOf(read(env, 'DATABASE_URL') ?? read(env, 'DIRECT_URL'))
  if (optIn && isLocalHost(host)) {
    return {
      headmasterPassword: headmaster ?? DEFAULT_HEADMASTER_PASSWORD,
      portalAdminPassword: portalAdmin ?? DEFAULT_PORTAL_ADMIN_PASSWORD,
      headmasterSource: headmaster ? HEADMASTER_PASSWORD_VAR : `${ALLOW_DEFAULT_PASSWORDS_VAR} (committed fallback)`,
      portalAdminSource: portalAdmin ? PORTAL_ADMIN_PASSWORD_VAR : `${ALLOW_DEFAULT_PASSWORDS_VAR} (committed fallback)`,
      usingCommittedDefaults: !headmaster || !portalAdmin,
    }
  }

  throw new SeedCredentialsError(missing, refusalMessage(missing, env))
}