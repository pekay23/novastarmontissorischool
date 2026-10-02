/**
 * CI: Playwright end-to-end tests.
 *
 * playwright.config.ts boots the portal on a pinned port (E2E_PORT, default
 * 3100) and runs chromium, firefox and webkit. Installing only chromium is the
 * mistake that makes the other two projects fail with "Executable doesn't
 * exist at .../firefox-.../". All three are installed here.
 *
 * Browsers land in PLAYWRIGHT_BROWSERS_PATH, which CI points at a cached
 * directory so the ~400 MB download happens once rather than every run.
 */

import { $ } from 'bun'
import { log } from './shared'

const step = 'ci:e2e'

const browsers = ['chromium', 'firefox', 'webkit'] as const

log(step, 'Generating Prisma client (e2e needs a resolvable client)')
await $`bun run --cwd packages/database db:generate`.quiet()

log(step, `Installing Playwright browsers: ${browsers.join(', ')}`)
await $`bunx playwright install --with-deps ${browsers}`.quiet()

log(step, `Running E2E suite on port ${process.env.E2E_PORT ?? '3100'}`)
await $`bun run test:e2e`

log(step, 'E2E passed')