/**
 * CI: the verification gate.
 *
 * Lint, typecheck and unit tests run in sequence rather than in parallel
 * because each is fast and a parallel failure is harder to read. The order is
 * deliberate: lint and typecheck catch structural mistakes in seconds, so paying
 * for the test run only after they are clean wastes less agent time.
 *
 * `turbo run` caches each task, so an unchanged task on a warm cache costs
 * almost nothing.
 */

import { $ } from 'bun'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { log } from './shared'

const step = 'ci:verify'

/** Repo root, so the `.env` this looks for is the one the migrate tool reads. */
const repoRoot = resolve(import.meta.dir, '..', '..')

const tasks = ['lint', 'typecheck', 'test'] as const

for (const task of tasks) {
  log(step, `Running ${task}`)
  // Not .quiet(): ESLint and tsc print the actual diagnostics to stdout, and
  // swallowing that turns a real lint failure into an unhelpful "exit code 1".
  await $`bun run ${task}`
  log(step, `${task} passed`)
}

/**
 * Is there a connection string for `db:migrate:verify` to use?
 *
 * Both places it can come from, because checking only `process.env` makes this
 * gate disagree with the command it gates: `bun run` loads a cwd-relative
 * `.env` before any of this runs, and `@novastar/migrate` reads the repo root
 * `.env` and `.env.local` itself. A developer with the URL in `.env` and
 * nothing exported would be reported as having no credentials, and the step
 * would skip on exactly the machine where a developer most wants to be told.
 *
 * `MIGRATE_SKIP_DOTENV=1` is honoured for the same reason the migrate tool
 * honours it: if the run is told to ignore the files, the files are not
 * credentials for this run, and finding them here would turn a clean
 * skip into a failure inside the command.
 *
 * Presence only. The command itself decides whether the string is usable and
 * names the variable when it is not, so there is nothing to validate here.
 */
function hasDatabaseCredentials(): boolean {
  if (process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim()) return true
  if (process.env.MIGRATE_SKIP_DOTENV === '1') return false

  for (const name of ['.env', '.env.local']) {
    try {
      const text = readFileSync(resolve(repoRoot, name), 'utf8')
      if (/^\s*(DATABASE_URL|DIRECT_URL)\s*=\s*\S/m.test(text)) return true
    } catch {
      // Absent .env is the normal case for a PR pipeline; nothing to find.
    }
  }
  return false
}

// Schema verification: a read-only comparison of the live schema against
// schema.prisma. Needs DATABASE_URL or DIRECT_URL. With neither, the step is
// a no-op — a pipeline without database credentials is a misconfiguration to
// fix in its own right, not schema drift, and must not go red over it.
log(step, 'Running db:migrate:verify')
if (hasDatabaseCredentials()) {
  await $`bun run db:migrate:verify`
  log(step, 'db:migrate:verify passed')
} else {
  log(step, 'db:migrate:verify skipped: no DATABASE_URL or DIRECT_URL in the environment or .env')
}

log(step, 'All checks passed')