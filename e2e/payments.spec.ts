import { test, expect } from '@playwright/test';

test.describe('Payments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@novastar.edu');
    await page.fill('input[name="password"]', 'TestPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('should display payment list', async ({ page }) => {
    await page.goto('/payments');
    await expect(page.locator('text=Payments')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('should create new payment', async ({ page }) => {
    await page.goto('/payments/new');
    await expect(page.locator('text=New Payment')).toBeVisible();
    
    await page.fill('input[name="studentId"]', 'student-123');
    await page.fill('input[name="amount"]', '500.00');
    await page.selectOption('select[name="method"]', 'CARD');
    await page.fill('input[name="description"]', 'Tuition payment');
    await page.click('button[type="submit"]');
    
    await expect(page.locator('text=Payment created')).toBeVisible();
    await expect(page).toHaveURL(/.*payments/);
  });

  test('should show payment details', async ({ page }) => {
    await page.goto('/payments');
    await page.click('table tbody tr:first-child button[aria-label="View details"]');
    await expect(page.locator('text=Payment Details')).toBeVisible();
    await expect(page.locator('text=Amount')).toBeVisible();
  });

  test('should filter payments by status', async ({ page }) => {
    await page.goto('/payments');
    await page.selectOption('select[name="status"]', 'COMPLETED');
    await expect(page.locator('table tbody tr')).toHaveCount(5);
  });

  test('should export payments to CSV', async ({ page }) => {
    await page.goto('/payments');
    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("Export CSV")');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/payments-.*\.csv/);
  });

  test('should handle refund', async ({ page }) => {
    await page.goto('/payments');
    await page.click('table tbody tr:first-child button[aria-label="Refund"]');
    await expect(page.locator('text=Refund Payment')).toBeVisible();
    await page.fill('input[name="amount"]', '100.00');
    await page.fill('input[name="reason"]', 'Partial refund');
    await page.click('button:has-text("Confirm Refund")');
    await expect(page.locator('text=Refund processed')).toBeVisible();
  });
});

test.describe('Fee Invoices', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'admin@novastar.edu');
    await page.fill('input[name="password"]', 'TestPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('should display invoice list', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.locator('text=Fee Invoices')).toBeVisible();
  });

  test('should generate invoice for student', async ({ page }) => {
    await page.goto('/invoices/new');
    await page.selectOption('select[name="studentId"]', 'student-123');
    await page.fill('input[name="amount"]', '2500.00');
    await page.fill('input[name="dueDate"]', '2026-10-15');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invoice generated')).toBeVisible();
  });

  test('should mark invoice as paid', async ({ page }) => {
    await page.goto('/invoices');
    await page.click('table tbody tr:first-child button:has-text("Mark Paid")');
    await expect(page.locator('text=Invoice marked as paid')).toBeVisible();
  });
});