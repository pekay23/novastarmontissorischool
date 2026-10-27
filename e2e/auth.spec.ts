import { expect, hasCredentials, loginAs, PORTAL_PREFIX, test, type Page } from './fixtures';

/** Authentication entry points, recovery, and credential-dependent session checks. */

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${PORTAL_PREFIX}/login`, { waitUntil: 'domcontentloaded' });
  });

  // `getByLabel('Password')` is ambiguous unless it is exact: the input is
  // labelled "Password" and the show/hide button carries `aria-label="Show
  // password"`, and Playwright's default label matching is a substring, so both
  // matched and every use of it failed in strict mode.
  const emailField = (page: Page) => page.getByLabel('Email', { exact: true });
  const passwordField = (page: Page) => page.getByLabel('Password', { exact: true });

  test('should show login form', async ({ page }) => {
    await expect(emailField(page)).toBeVisible();
    await expect(passwordField(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('should associate every label with its input', async ({ page }) => {
    // Each control must be reachable by its accessible name, which is the
    // contract the specs and screen readers both depend on.
    await expect(emailField(page)).toHaveAttribute('name', 'email');
    await expect(passwordField(page)).toHaveAttribute('name', 'password');
  });

  test('should reject invalid credentials', async ({ page }) => {
    await emailField(page).fill('nobody@example.invalid');
    await passwordField(page).fill('definitely-not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The form must stay on /login and announce the failure rather than
    // navigating away or silently doing nothing.
    await expect(page).toHaveURL(new RegExp(`${PORTAL_PREFIX}/login`));
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

  test('should protect routes from unauthenticated access', async ({ page }) => {
    await page.goto(`${PORTAL_PREFIX}/dashboard`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });

  test('should request password reset', async ({ page }) => {
    const message = 'If that address has an account, a reset link is on its way.';
    await page.route('**/portal/api/auth/forgot-password', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ message }),
    }));
    await page.goto(`${PORTAL_PREFIX}/forgot-password/`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email', { exact: true }).fill('parent@example.test');
    await page.getByRole('button', { name: 'Send Reset Link' }).click();
    await expect(page.getByRole('status').filter({ hasText: message })).toBeVisible();
  });


});


test.describe('Signed-in session', () => {
  test.skip(!hasCredentials(), 'Set E2E_EMAIL and E2E_PASSWORD for an existing isolated test account.');
  test('should sign in and land on the dashboard', async ({ page }) => {
    await loginAs(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should logout successfully', async ({ page }) => {
    await loginAs(page);

    // The sidebar renders a plain "Sign Out" button; there is no
    // "User menu" aria-label anywhere in the portal.
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

});

test('should prompt for MFA after login', async () => {
    // The application supports TOTP, but this suite has no enrolled test account.
    test.fixme(
      'An enrolled MFA test account and a controllable TOTP code are required for this signed-in flow.',
    );
  });
