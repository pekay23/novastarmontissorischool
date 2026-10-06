/**
 * CI: install + generate.
 *
 * Two facts make this more than `bun install`:
 *
 * 1. `--frozen-lockfile` does not reliably run @prisma/client's postinstall
 *    under bun's isolated node_modules layout. On a clean machine the client is
 *    therefore never generated, and because packages/database/index.ts imports
 *    PrismaClient plus the models and enums, every typecheck and build then
 *    fails with TS2305. So generation is an explicit step.
 *
 * 2. TURBO_TOKEN, when present, turns on Turborepo's remote cache. That is the
 *    single biggest build-time win: an unchanged task in an unchanged package
 *    is restored from the remote instead of re-running.
 */

import { $ } from 'bun'
import { log } from './shared'

const step = 'ci:install'

async function main() {
  log(step, 'Installing workspace dependencies')
  await $`bun install --frozen-lockfile`.quiet()

  if (process.env.TURBO_TOKEN && process.env.TURBO_TOKEN !== 'changeme') {
    log(step, `Turbo remote cache enabled (team: ${process.env.TURBO_TEAM ?? 'unset'})`)
  } else {
    log(step, 'TURBO_TOKEN not set - local Turbo cache only (slower builds)')
  }

  log(step, 'Generating Prisma client')
  await $`bun run --cwd packages/database db:generate`.quiet()

  log(step, 'Done')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})