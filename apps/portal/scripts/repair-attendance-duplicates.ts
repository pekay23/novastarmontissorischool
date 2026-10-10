/**
 * Data repair — collapse duplicate `AttendanceStudent` rows.
 *
 * The write path stored `period: null` while looking up
 * `period: ''`, so every re-save of the same student/day
 * inserted a second row. PostgreSQL treats every NULL as
 * distinct in a btree unique index, so the unique constraint
 * on (tenantId, studentId, date, period) could not stop it —
 * the duplicates have to be collapsed here, once, after the
 * write path is fixed.
 *
 * Groups are collapsed to one row each. The row kept is the
 * one with the most recent `updatedAt`: Prisma rewrites
 * `updatedAt` on every save, so the newest row carries the
 * status/notes/marker the UI last wrote, and the older rows
 * are stale copies of the same logical attendance. Ties (rows
 * written in one bulk save share an updatedAt) break by the
 * latest `createdAt`, then by `id`, so the choice is
 * deterministic and re-running the script is idempotent — a
 * second run finds zero groups.
 *
 * Legacy NULL periods and the `''` whole-day sentinel are the
 * SAME logical period here: the fixed write path now stores
 * `''`, and migration `20261003000000_unifiedtransform_port_wave0`
 * backfills every remaining NULL to `''` before making the
 * column NOT NULL. Grouping on `COALESCE(period, '')` means a
 * leftover NULL row and a new `''` row for the same student/day
 * collapse into one, so the migration's backfill cannot create
 * a unique violation. Run this BEFORE applying that migration.
 *
 * Requires DATABASE_URL, as every other portal script does.
 *
 * Run (dry run — prints the plan, changes nothing):
 *   cd apps/portal && bun run scripts/repair-attendance-duplicates.ts
 *
 * Apply (deletes the duplicate rows, one transaction per group):
 *   cd apps/portal && bun run scripts/repair-attendance-duplicates.ts --apply
 *
 * `--apply` against anything that is not a loopback database additionally
 * requires `--allow-production`, and then a typed confirmation naming the exact
 * row count. Both guards exist because there is no local database to run
 * against by accident: `packages/database` speaks Neon SQL-over-HTTP, so
 * DATABASE_URL points at the live Neon host whether the operator is on their
 * laptop or on a deploy machine. See `resolveDatabaseTarget` for the rule.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

interface DuplicateGroup {
  tenantId: string
  studentId: string
  date: Date
  /** The logical period: the stored value, or '' for legacy NULLs. */
  period: string
  count: number
}

interface GroupRow {
  id: string
}

/** One duplicate row that would be deleted, with the row kept in its place. */
interface PlannedGroup {
  keep: string
  deleteIds: string[]
}

const APPLY = process.argv.includes('--apply')
const ALLOW_PRODUCTION = process.argv.includes('--allow-production')

/** Prisma re-writes `updatedAt` on every save, so order by it first. */
const KEEP_ORDER = '"updatedAt" DESC, "createdAt" DESC, "id" DESC'

/**
 * Hosts that cannot be a production database.
 *
 * Default-deny: only an explicit loopback allow-list counts as local, so a host
 * nobody thought about is treated as production and demands `--allow-production`.
 * An allow-list that had to enumerate every staging and provider hostname would
 * be one more list to keep current, and every entry on it is a way to delete
 * live rows by accident.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
])

/** Where the script is pointed. Host and database name only — never the URL. */
export interface DatabaseTarget {
  host: string
  database: string
  isProduction: boolean
}

/**
 * Read `DATABASE_URL` and decide whether it names a production database.
 *
 * The URL is parsed and immediately reduced to host plus database name. Nothing
 * downstream ever holds the original string, so no code path can print a
 * password: `URL.password` and `URL.username` are never read, and the value
 * returned here is the only thing the script reports.
 *
 * Exported so the rule can be tested without a database. Returns `null` when
 * there is no URL or it cannot be parsed, which the caller treats as a refusal
 * — an unidentifiable target is not a safe target.
 */
export function resolveDatabaseTarget(
  raw: string | undefined = process.env.DATABASE_URL,
): DatabaseTarget | null {
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const host = url.hostname
  if (!host) return null

  const isLoopback =
    LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')

  return {
    host,
    // A Neon/Postgres URL carries the database as the first path segment.
    database: url.pathname.replace(/^\/+/, '').split('/')[0] ?? '',
    isProduction: !isLoopback,
  }
}

/**
 * Strip anything outside printable ASCII.
 *
 * The PowerShell console this repo is developed on is cp1252 and renders any
 * other byte as mojibake, and the values interpolated below come from the
 * database rather than from source. Replacing them keeps every line this script
 * prints readable on the console it will actually be run from.
 */
function ascii(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '?')
}

/**
 * Ask the operator to type the exact expected token.
 *
 * Refuses outright when stdin is not a terminal. That is the property that
 * matters: a piped or redirected stdin must never be able to satisfy the
 * confirmation, so this script cannot be waved through by a pipeline, a `yes`,
 * or a CI step that happens to inherit a TTY-less environment.
 */
/**
 * The exact token the operator must type to approve a delete.
 *
 * Exported so the approval step is testable without a TTY, and so the count
 * cannot drift between what is printed and what is demanded.
 */
export function confirmationToken(totalRows: number): string {
  return `DELETE ${totalRows}`
}

async function confirm(expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('')
    console.error('Refusing to delete without a terminal to confirm on.')
    console.error('Re-run this command from an interactive terminal.')
    return false
  }

  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`Type "${expected}" to proceed: `)).trim()
    return answer === expected
  } finally {
    rl.close()
  }
}

/** Read the duplicate groups and the exact rows a delete would remove. No writes. */
async function buildPlan(): Promise<PlannedGroup[]> {
  // Raw SQL for both reads: the group key is a COALESCE, and the
  // legacy NULL rows must stay reachable even once the generated
  // client types `period` as non-nullable.
  const groups = await prisma.$queryRaw<DuplicateGroup[]>`
    SELECT "tenantId", "studentId", "date", COALESCE("period", '') AS "period", COUNT(*)::int AS count
    FROM "AttendanceStudent"
    GROUP BY "tenantId", "studentId", "date", COALESCE("period", '')
    HAVING COUNT(*) > 1
  `

  const plan: PlannedGroup[] = []
  for (const group of groups) {
    const rows = await prisma.$queryRaw<GroupRow[]>`
      SELECT "id"
      FROM "AttendanceStudent"
      WHERE "tenantId" = ${group.tenantId}
        AND "studentId" = ${group.studentId}
        AND "date" = ${group.date}
        AND COALESCE("period", '') = ${group.period}
      ORDER BY ${Prisma.raw(KEEP_ORDER)}
    `
    const [keep, ...duplicates] = rows
    if (!keep || duplicates.length === 0) continue

    plan.push({ keep: keep.id, deleteIds: duplicates.map((row) => row.id) })
  }

  return plan
}

async function main(): Promise<void> {
  const target = resolveDatabaseTarget()
  if (!target) {
    console.error('DATABASE_URL is missing or unparseable, so the target database')
    console.error('cannot be identified. Refusing to touch it.')
    process.exitCode = 1
    return
  }

  // Refused before `buildPlan`, not after it. Reading the duplicate groups is
  // harmless, but it is still opening a connection and running queries against
  // the live database from a run the operator did not authorise, and it makes the
  // refusal depend on a query that can itself fail. The guard belongs at the
  // boundary, immediately after the target is identified and before any I/O.
  if (APPLY && target.isProduction && !ALLOW_PRODUCTION) {
    console.error('')
    console.error(`Target host:     ${target.host}`)
    console.error(`Target database: ${target.database || '(none in URL)'}`)
    console.error('')
    console.error('That target is not a loopback database, so it is treated as production.')
    console.error('Re-run with --allow-production if you are certain this is the')
    console.error('database you mean, and you will still be asked to confirm.')
    process.exitCode = 1
    return
  }

  const plan = await buildPlan()

  if (plan.length === 0) {
    console.log('No duplicate AttendanceStudent rows found.')
    return
  }

  // The whole plan is read before the first delete, so the count printed below is
  // the count that will actually be deleted rather than an estimate.
  const totalRows = plan.reduce((sum, group) => sum + group.deleteIds.length, 0)

  for (const group of plan) {
    console.log(
      `  would delete ${group.deleteIds.length} row(s), keeping ${group.keep}: ` +
        `[${group.deleteIds.map(ascii).join(', ')}]`,
    )
  }

  if (!APPLY) {
    console.log('')
    console.log(`Dry run - no rows were deleted. ${plan.length} group(s), ${totalRows} row(s) would go.`)
    console.log('Pass --apply to delete.')
    return
  }

  console.log('')
  console.log('=== APPLYING ===')
  console.log(`Target host:     ${target.host}`)
  console.log(`Target database: ${target.database || '(none in URL)'}`)
  console.log(`Groups:          ${plan.length}`)
  console.log(`Rows to delete:  ${totalRows}`)

  if (target.isProduction) {
    console.log('Production target: allowed by --allow-production.')
  }

  // The token carries the count, so confirming means reading the number that was
  // printed above rather than acknowledging a prompt in the abstract.
  const token = confirmationToken(totalRows)
  const confirmed = await confirm(token)
  if (!confirmed) {
    console.error('')
    console.error('Confirmation did not match. Nothing was deleted.')
    process.exitCode = 1
    return
  }

  let deleted = 0
  for (const group of plan) {
    // One transaction per group: a crash mid-run leaves whole groups
    // intact, and re-running the script picks up where it stopped.
    await prisma.$transaction(async (tx) => {
      await tx.attendanceStudent.deleteMany({ where: { id: { in: group.deleteIds } } })
    })
    deleted += group.deleteIds.length
    console.log(`  deleted ${group.deleteIds.length} row(s), kept ${group.keep}`)
  }

  console.log('')
  console.log(`Deleted ${deleted} row(s) across ${plan.length} group(s).`)
}

// `import.meta.main` rather than an unconditional call, so importing this module
// — a test, a reviewer's REPL — cannot start a destructive run. `bun run
// scripts/repair-attendance-duplicates.ts` sets it, exactly as it does for
// `tools/sync-cli`.
if (import.meta.main) {
  main()
    .catch((error: unknown) => {
      console.error('Repair failed:', error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}