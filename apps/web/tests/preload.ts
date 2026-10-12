import { mock } from 'bun:test'

/**
 * Preload for the apps/web test suite.
 *
 * `server-only` throws at import time when it is evaluated outside a React
 * Server Component, and it IS installed in this workspace
 * (`node_modules/.bun/server-only@0.0.1`). Roughly twenty test files under
 * `tests/` register a `mock.module('server-only', ...)` stub at their own module
 * scope, and their comments say the package "is not installed in this workspace"
 * — which stopped being true. Bun's module-mock registry is process-global and
 * outlives the file that registered it, so whichever file happens to evaluate
 * the real module first takes down the run: with `admin-context.test.ts` or
 * `create-user.test.ts` running ahead of `data-integrity.test.ts`, the latter
 * died with "This module cannot be imported from a Client Component module" as
 * an unhandled error between its tests, which aborted `bun test tests` after
 * fourteen files.
 *
 * Registering the stub HERE, before any test file is evaluated, means no file
 * can reach the real module whatever it registers afterwards — the same shape
 * `packages/domain/bunfig.toml` already preloads for that workspace.
 *
 * Deliberately minimal. `tests/preload.ts` is not this file's own `preload.ts`
 * sibling, and the shared `tests/harness.ts` is deliberately NOT preloaded here:
 * its `beforeEach` re-registers a complete `@/lib/prisma` double, and roughly
 * twenty files register their own incomplete doubles at module scope with no
 * `beforeEach` of their own, so preloading the harness lets it clobber theirs.
 * Preloading it was tried and reverted: it fixed the abort above and the
 * `@prisma/client` namespace corruption behind it, but broke eight
 * `@novastar/notifications` tests whose failures need a separate cause.
 */
mock.module('server-only', () => ({}))
