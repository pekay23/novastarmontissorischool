import { defineConfig, devices } from '@playwright/test';

/**
 * E2E harness.
 *
 * Three deliberate choices here, each of which fixes a specific way this suite
 * used to waste CI time:
 *
 * 1. The webServer runs the MERGED WEB APP ONLY (apps/web), on a pinned port.
 *    It used to run the legacy portal app (apps/portal) via turbo filter.
 *    The merged app serves public site (/), portal (/portal/*), and admin (/admin/*)
 *    from a single Next.js process. The dev script is `NEXT_TURBOPACK=0 HOST=0.0.0.0 next dev --port 3000`
 *    and the trailing `-- --port` overrides the port.
 *
 * 2. Retries are 0 and the per-test timeout is short.
 *    A selector that matches zero elements fails instantly, not slowly, so
 *    retries and long timeouts cannot rescue a broken suite -- they only delay
 *    the signal. The previous config ran 90 failures x 3 retries x 30s, which
 *    is exactly the 2h16m the last CI run took to report three passing tests.
 *    A red suite should surface in minutes.
 *
 * 3. The webServer probes /portal/login, not just the origin.
 *    `url` only proves something answers on the port. Probing a real route
 *    waits until the app has actually compiled that page, so the first test
 *    does not pay the dev-compile cost inside its own timeout.
 *    The /portal prefix comes from the directory structure (apps/web/app/portal),
 *    not from a basePath config — apps/web/next.config.ts has no basePath.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
/** The app's portal path prefix. Every portal route is reached through this prefix. */
const BASE_PATH = '/portal';
const productionServer = process.env.E2E_SERVER_MODE === 'production';

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
    command: productionServer
      ? `bun run --cwd apps/web start --port ${PORT}`
      : `bunx turbo run dev --filter=web -- --port ${PORT}`,
    url: `${BASE_URL}${BASE_PATH}/login`,
    reuseExistingServer: !process.env.CI,
    // 300s, not the 120s default: a cold Turbopack dev server takes ~51s to
    // compile the portal's first page (the (portal) route group plus the proxy),
    // and under parallel load that stretches. 180s made the run time out before
    // a single test executed, which is indistinguishable from the suite failing.
    timeout: 300_000,
    // Piped, not ignored: with `ignore` the dev server never came up under
    // Playwright on Windows (every run died at the webServer timeout), which is
    // a worse failure than the reporter output being interleaved with the
    // server's compile log.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
