import { expect, hasCredentials, loginAs, test } from './fixtures';

/**
 * Fees and payments coverage.
 *
 * The previous payments.spec.ts drove /payments, /payments/new, /invoices and
 * /invoices/new with a CSV export, a refund flow and a "mark as paid" action.
 * None of those routes exist. Payments live on a single /fees page that fetches
 * from /api/finance/invoices, and the page offers invoice creation, editing,
 * deletion and payment capture -- not CSV export or refunds. Those behaviours
 * are retained below as test.fixme with what each one would need.
 *
 * Row-count assertions are deliberately absent. The old suite asserted
 * toHaveCount(5), which pins the test to whatever the seed happens to produce
 * today and breaks the moment anyone adds a row. These tests assert structure
 * and behaviour instead.
 */

test.describe('Fees and payments', () => {
  test.skip(
    !hasCredentials(),
    'Set E2E_EMAIL and E2E_PASSWORD, then run `bun run db:seed` to provision the account.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAs(page);
    await page.goto('/fees');
  });

  test('should render the invoices surface', async ({ page }) => {
    await expect(page.getByRole('heading').first()).toBeVisible();
    // The page must finish its initial fetch rather than spin forever; a
    // table or an explicit empty state are both acceptable outcomes.
    await expect(
      page.getByRole('table').or(page.getByText(/no invoices|empty/i)).first(),
    ).toBeVisible();
  });

  test('should expose a way to record a new invoice', async ({ page }) => {
    await expect(page.getByRole('button', { name: /new invoice|add invoice|\+/i }).first())
      .toBeVisible();
  });

  test('should not leak a server error into the console', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (err) => failures.push(err.message));

    await page.reload();
    await expect(page.getByRole('heading').first()).toBeVisible();

    expect(failures).toEqual([]);
  });
});

test.describe('Invoice lifecycle', () => {
  test.fixme(
    'should generate an invoice for a student',
    'The /fees page creates invoices through a dialog, not a dedicated /invoices/new route. Needs a seeded student to select, then a form submission that asserts the created row.',
  );

  test.fixme(
    'should mark an invoice as paid',
    'Payment capture exists on /fees but marks an invoice paid via the payment dialog against a real finance record. Needs a seeded invoice with a known total so the assertion is deterministic.',
  );

  test.fixme(
    'should handle a refund',
    'No refund flow exists in the portal. Needs a refund model, a permitted state transition on a paid invoice, and audit logging for it.',
  );

  test.fixme(
    'should export payments to CSV',
    'No export control exists on /fees. Needs a server endpoint that streams CSV and a trigger in the UI.',
  );

  test.fixme(
    'should filter payments by status',
    'The /fees page filters by student name search only. Needs a status filter wired to the API and a deterministic fixture set covering each status.',
  );
});