import { defineConfig, devices } from '@playwright/test'

/**
 * Public-site e2e harness. Separate from the root config on purpose.
 *
 * The root `playwright.config.ts` runs the PORTAL on a pinned port and its
 * `webServer` starts nothing else, so a public-site spec added there would 404 on
 * every route — the same failure that config's own header warns about. It also
 * runs three browser projects against one dev server, and the specs share a test
 * database, so a second app cannot join it without making the portal suite
 * non-deterministic. Isolating the config means this suite cannot affect portal
 * CI at all: root CI invokes `bun run test:e2e`, which is `playwright test` in the
 * repo root and only ever sees the root config.
 *
 * What it tests is the ARTIFACT, not the dev server. `apps/public-site` is
 * `output: 'export'`, so there is no `next start` — the honest thing to point a
 * browser at is the exported directory, served by `tools/serve-export.mjs`. A dev
 * server compiles routes on demand and rewrites links, so it will pass a spec the
 * deployed files fail. It also answers 308 for extensionless inner paths and 404
 * for anything not yet compiled, both of which this suite asserts against.
 *
 * The build runs inside `webServer.command` so the suite is self-sufficient.
 * Under `turbo run test:e2e` the `dependsOn: ["build"]` has already produced it
 * and this second call is a cache hit.
 */

const PORT = Number(process.env.PUBLIC_SITE_E2E_PORT ?? 3400);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  /*
   * Matches the root config's reasoning: retries on a suite that cannot pass
   * multiply wall-clock time and never turn a failure into a pass. A selector
   * matching zero elements should surface in seconds, not minutes.
   */
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },

  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `bun run build && node ../../tools/serve-export.mjs --root out --port ${PORT}`,
    /*
     * Probe the home page rather than the origin. `url` alone only proves
     * something bound the port; fetching a real route waits until the server is
     * actually answering documents, so the first test does not pay the startup
     * cost inside its own timeout.
     */
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    /*
     * 300s, not the root config's 180s. `cwd` defaults to this config's
     * directory, so `bun run build` here is public-site's own `next build` — which
     * means turbo's cache is BYPASSED and every run is a cold production build.
     * It measured 51s cold on this machine but overran 180s on a second run while
     * a dev server was still resident. Under `turbo run test:e2e` the
     * `dependsOn: ["build"]` means the artifact is already on disk and this
     * command's build is the fast path, so the ceiling only matters for a direct
     * `bun run test:e2e`.
     */
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});