import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared E2E fixtures and credentials.
 *
 * Credentials come from the environment, never from literals in a spec. The
 * old suite hardcoded seven addresses (admin@novastar.edu, teacher@...,
 * mfa@...) that no seed has ever created, so every test that tried to sign in
 * failed at the fill step and the real assertions never ran. Reading them from
 * env means a suite runs against whatever account the environment actually
 * provisioned, and a missing account surfaces as a clear setup error rather
 * than 90 identical timeouts.
 */

/** Set E2E_EMAIL / E2E_PASSWORD / E2E_SCHOOL_CODE to run the signed-in specs. */
export const CREDENTIALS = {
  email: process.env.E2E_EMAIL ?? '',
  password: process.env.E2E_PASSWORD ?? '',
  schoolCode: process.env.E2E_SCHOOL_CODE ?? '',
};

/**
 * True when the environment supplied enough to sign in.
 *
 * Signed-in specs are skipped rather than failed when this is false, because
 * "no test account" is a configuration gap, not a product regression, and CI
 * must not go red for it.
 */
export function hasCredentials(): boolean {
  return Boolean(CREDENTIALS.email && CREDENTIALS.password);
}

/**
 * Fills the login form and waits for the dashboard.
 *
 * The school code is only typed when one is configured; the server falls back
 * to DEFAULT_SCHOOL_CODE when it is blank.
 */
export async function loginAs(page: Page, overrides: Partial<typeof CREDENTIALS> = {}) {
  const email = overrides.email ?? CREDENTIALS.email;
  const password = overrides.password ?? CREDENTIALS.password;
  const schoolCode = overrides.schoolCode ?? CREDENTIALS.schoolCode;

  if (!email || !password) {
    throw new Error(
      'loginAs called without credentials. Set E2E_EMAIL and E2E_PASSWORD, ' +
        'and run the seed (bun run db:seed) to create the account.',
    );
  }

  await page.goto('/login');
  await page.getByLabel('School Code').fill(schoolCode);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // The layout redirects to /login when the session is unauthenticated, so
  // landing on /dashboard is proof the credentials were accepted.
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

/** Routes the portal actually serves. Keep this in step with app/(portal). */
export const PORTAL_ROUTES = [
  '/dashboard',
  '/students',
  '/teachers',
  '/enrollment',
  '/attendance',
  '/grades',
  '/reports',
  '/calendar',
  '/announcements',
  '/fees',
  '/library',
  '/inventory',
] as const;

export const test = base.extend<{ loginAs: () => Promise<void> }>({
  loginAs: async ({ page }, use) => {
    await use(() => loginAs(page));
  },
});

export { expect };