import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should show login form', async ({ page }) => {
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.fill('input[name="email"]', 'invalid@test.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid credentials')).toBeVisible();
  });

  test('should redirect to dashboard after successful login', async ({ page }) => {
    await page.fill('input[name="email"]', 'admin@novastar.edu');
    await page.fill('input[name="password"]', 'TestPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('should logout successfully', async ({ page }) => {
    await page.fill('input[name="email"]', 'admin@novastar.edu');
    await page.fill('input[name="password"]', 'TestPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard/);
    
    await page.click('button[aria-label="User menu"]');
    await page.click('text=Sign out');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should protect routes from unauthenticated access', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });
});

test.describe('Password Reset Flow', () => {
  test('should request password reset', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.fill('input[name="email"]', 'admin@novastar.edu');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Reset email sent')).toBeVisible();
  });
});

test.describe('MFA Flow', () => {
  test('should prompt for MFA after login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'mfa@novastar.edu');
    await page.fill('input[name="password"]', 'TestPass123!');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Enter verification code')).toBeVisible();
  });
});