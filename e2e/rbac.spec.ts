import { expect, hasCredentials, loginAs, PORTAL_PREFIX, PORTAL_ROUTES, test } from './fixtures';

/** Portal navigation, server route protection, and role-fixture requirements. */

test.describe('Portal navigation', () => {
  test.skip(
    !hasCredentials(),
    'Set E2E_EMAIL and E2E_PASSWORD for an existing isolated test account.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('should render the sidebar with the primary destinations', async ({ page }) => {
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Students' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Teachers' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Attendance' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Grades' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Fees & Payments' })).toBeVisible();
  });

  test('should show Settings to a privileged role', async ({ page }) => {
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Settings' }),
    ).toBeVisible();
  });

  for (const route of PORTAL_ROUTES) {
    test(`should load ${route} without error`, async ({ page }) => {
      const failures: string[] = [];
      page.on('pageerror', (err) => failures.push(err.message));

      await page.goto(`${PORTAL_PREFIX}${route}`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(route));
      // A heading marks the page as actually rendered rather than an empty
      // shell or a 404 that still returns HTTP 200.
      await expect(page.getByRole('heading').first()).toBeVisible();

      expect(failures, `uncaught errors on ${route}`).toEqual([]);
    });
  }
});

test.describe('Route protection', () => {
  const PROTECTED = ['/dashboard', '/students', '/grades', '/fees', '/settings'];

  for (const route of PROTECTED) {
    test(`should redirect ${route} to login when signed out`, async ({ page }) => {
      await page.goto(`${PORTAL_PREFIX}${route}`, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(`${PORTAL_PREFIX}/login`));
    });
  }

  test('should enforce route protection on the server', async ({ request }) => {
    const response = await request.get(PORTAL_PREFIX + '/students/', { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308]).toContain(response.status());
    expect(response.headers().location).toContain(PORTAL_PREFIX + '/login');
  });
});

test.describe('Role-Based Access Control', () => {
  test('admin role: should access all admin routes', async () => {
    test.fixme('Requires isolated accounts with the relevant role and known scoped records.');
  });

  test('teacher role: should access teacher routes and be denied admin routes', async () => {
    test.fixme('Requires isolated accounts with the relevant role and known scoped records.');
  });

  test('parent role: should view child grades and pay invoices', async () => {
    test.fixme('Requires isolated accounts with the relevant role and known scoped records.');
  });

  test('student role: should be denied parent, teacher and admin routes', async () => {
    test.fixme('Requires isolated accounts with the relevant role and known scoped records.');
  });

  test('cross-tenant isolation: should not see data from other tenants', async () => {
    // Requires two seeded tenants and per-query tenant scoping.
    test.fixme(
      "Requires isolated tenants and known resource IDs to verify a cross-tenant request is refused.",
    );
  });
});
