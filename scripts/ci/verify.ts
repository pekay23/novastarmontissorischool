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
import { log } from './shared'

const step = 'ci:verify'

const tasks = ['lint', 'typecheck', 'test'] as const

for (const task of tasks) {
  log(step, `Running ${task}`)
  // Not .quiet(): ESLint and tsc print the actual diagnostics to stdout, and
  // swallowing that turns a real lint failure into an unhelpful "exit code 1".
  await $`bun run ${task}`
  log(step, `${task} passed`)
}

log(step, 'All checks passed')