import { expect, hasCredentials, loginAs, test } from './fixtures';

/**
 * Authentication coverage for the routes the portal actually serves.
 *
 * The previous auth.spec.ts navigated to /forgot-password and drove an MFA
 * flow. Neither exists: apps/portal has 22 pages and no password-reset route,
 * and lib/auth.ts has no TOTP or second-factor logic at all. Those tests are
 * retained below as test.fixme with the reason, so they are visible in the
 * report and flip to running the day the feature lands, rather than being
 * deleted or silently failing.
 */

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should show login form', async ({ page }) => {
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByLabel('School Code')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('should associate every label with its input', async ({ page }) => {
    // Each control must be reachable by its accessible name, which is the
    // contract the specs and screen readers both depend on.
    await expect(page.getByLabel('Email')).toHaveAttribute('name', 'email');
    await expect(page.getByLabel('Password')).toHaveAttribute('name', 'password');
    await expect(page.getByLabel('School Code')).toHaveAttribute('name', 'schoolCode');
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.getByLabel('Email').fill('nobody@example.invalid');
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByLabel('School Code').fill('definitely-not-a-school');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The form must stay on /login and announce the failure rather than
    // navigating away or silently doing nothing.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('should not attempt sign-in with an empty form', async ({ page }) => {
    // The handler used to `return` before calling signIn when schoolCode was
    // blank, so the server-side DEFAULT_SCHOOL_CODE fallback was unreachable
    // from the UI. Browser validation should surface it as a normal
    // constraint violation instead.
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
    const validity = await page.getByLabel('Email').evaluate(
      (el) => (el as HTMLInputElement).checkValidity(),
    );
    expect(validity).toBe(false);
  });

  test('should sign in and land on the dashboard', async ({ page }) => {
    test.skip(
      !hasCredentials(),
      'Set E2E_EMAIL and E2E_PASSWORD, then run `bun run db:seed` to provision the account.',
    );
    await loginAs(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should logout successfully', async ({ page }) => {
    test.skip(
      !hasCredentials(),
      'Set E2E_EMAIL and E2E_PASSWORD, then run `bun run db:seed` to provision the account.',
    );
    await loginAs(page);

    // The sidebar renders a plain "Sign Out" button; there is no
    // "User menu" aria-label anywhere in the portal.
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('should protect routes from unauthenticated access', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test.fixme(
    'should request password reset',
    'No password-reset feature exists. Needs an /forgot-password route, a reset token table, and an email sender before this can be tested.',
  );

  test.fixme(
    'should prompt for MFA after login',
    'No MFA implementation exists. apps/portal/lib/auth.ts has no TOTP or second-factor logic, so there is nothing to prompt for.',
  );
});