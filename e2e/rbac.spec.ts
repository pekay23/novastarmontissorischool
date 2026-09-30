import { expect, hasCredentials, loginAs, PORTAL_ROUTES, test } from './fixtures';

/**
 * Navigation coverage for the portal shell.
 *
 * This file used to be "role-based access control" and asserted against
 * /admin/users, /admin/teacher/*, /parent/*, /student/* and a cross-tenant
 * isolation check. None of those routes exist. The portal serves exactly the
 * routes in PORTAL_ROUTES, and its only access control is a client-side
 * redirect in (portal)/layout.tsx: there is no middleware.ts, so no server
 * ever rejects an unauthenticated request to a protected page.
 *
 * The role-specific and tenant-isolation tests are kept as test.fixme with
 * their requirements spelled out, so the intended coverage stays visible
 * instead of being silently deleted.
 */

test.describe('Portal navigation', () => {
  test.skip(
    !hasCredentials(),
    'Set E2E_EMAIL and E2E_PASSWORD, then run `bun run db:seed` to provision the account.',
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
    // The seed assigns every portal user the HEADMASTER role, but the layout
    // gated Settings on 'admin'/'super_admin' -- a role name no seed creates.
    // HEADMASTER is documented as having full access, so it must see Settings.
    await expect(
      page.getByRole('navigation').getByRole('link', { name: 'Settings' }),
    ).toBeVisible();
  });

  for (const route of PORTAL_ROUTES) {
    test(`should load ${route} without error`, async ({ page }) => {
      const failures: string[] = [];
      page.on('pageerror', (err) => failures.push(err.message));

      await page.goto(route);
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
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test.fixme(
    'should enforce route protection on the server',
    'Protection is currently a client-side redirect in (portal)/layout.tsx. There is no middleware.ts, so the protected page payload is served to an unauthenticated client and only hidden after hydration. Needs middleware that gates the request before render.',
  );
});

test.describe('Role-Based Access Control', () => {
  test.fixme(
    'admin role: should access all admin routes',
    'No /admin/* routes exist. Needs an admin surface (users, roles, billing, audit logs, tenants) and an admin role assigned by the seed.',
  );

  test.fixme(
    'teacher role: should access teacher routes and be denied admin routes',
    'No /teacher/* routes exist. Needs role-scoped routes plus per-route server-side authorization; navigation visibility alone is not access control.',
  );

  test.fixme(
    'parent role: should view child grades and pay invoices',
    'No /parent/* routes exist. Needs the parent portal surface and per-child scoping on every query.',
  );

  test.fixme(
    'student role: should be denied parent, teacher and admin routes',
    'No /student/* routes exist. Needs the student surface and server-side role checks.',
  );

  test.fixme(
    'cross-tenant isolation: should not see data from other tenants',
    'Requires two seeded tenants and per-query tenant scoping. The previous version compared two row counts, which does not demonstrate isolation; it needs one tenant to attempt a fetch of the other tenant\'s resource ID and be refused.',
  );
});