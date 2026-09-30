import { defineConfig, devices } from '@playwright/test';

/**
 * E2E harness.
 *
 * Three deliberate choices here, each of which fixes a specific way this suite
 * used to waste CI time:
 *
 * 1. The webServer runs the PORTAL ONLY, on a pinned port.
 *    It used to run `bun run dev` (i.e. `turbo run dev`), which starts the
 *    portal and the public site at once. Neither declares a PORT, so both ask
 *    for 3000 and Next silently hands the loser 3001. Whichever app won was a
 *    coin flip, and the public site has no /login or /dashboard at all, so on a
 *    bad run every test 404s. Pinning the port and filtering to one app makes
 *    the target deterministic.
 *
 * 2. Retries are 0 and the per-test timeout is short.
 *    A selector that matches zero elements fails instantly, not slowly, so
 *    retries and long timeouts cannot rescue a broken suite -- they only delay
 *    the signal. The previous config ran 90 failures x 3 retries x 30s, which
 *    is exactly the 2h16m the last CI run took to report three passing tests.
 *    A red suite should surface in minutes.
 *
 * 3. The webServer probes /login, not just the origin.
 *    `url` only proves something answers on the port. Probing a real route
 *    waits until the app has actually compiled that page, so the first test
 *    does not pay the dev-compile cost inside its own timeout.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  // See note 2 above. Retrying a suite that cannot pass just multiplies the
  // wall clock; it never converts a failure into a pass.
  retries: 0,
  timeout: 20_000,
  expect: { timeout: 7_000 },

  // One worker on CI: the specs share a single dev server and a single test
  // database, so parallel workers would interleave sessions and row counts.
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Surface the server error overlay in the trace rather than silently
    // screenshotting a blank page.
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: `bunx turbo run dev --filter=portal -- --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});