import { test, expect } from '@playwright/test';

test.describe('Role-Based Access Control', () => {
  test.describe('Admin role', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.fill('input[name="email"]', 'admin@novastar.edu');
      await page.fill('input[name="password"]', 'TestPass123!');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*dashboard/);
    });

    test('should access all admin routes', async ({ page }) => {
      const adminRoutes = [
        '/admin/users',
        '/admin/settings',
        '/admin/billing',
        '/admin/audit-logs',
        '/admin/tenants'
      ];

      for (const route of adminRoutes) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/.*unauthorized/);
        await expect(page.locator('h1')).toBeVisible();
      }
    });

    test('should manage users', async ({ page }) => {
      await page.goto('/admin/users');
      await expect(page.locator('text=User Management')).toBeVisible();
      
      await page.click('button:has-text("Add User")');
      await page.fill('input[name="email"]', 'newuser@novastar.edu');
      await page.fill('input[name="name"]', 'New User');
      await page.selectOption('select[name="role"]', 'TEACHER');
      await page.click('button[type="submit"]');
      await expect(page.locator('text=User created')).toBeVisible();
    });

    test('should manage roles and permissions', async ({ page }) => {
      await page.goto('/admin/roles');
      await expect(page.locator('text=Role Management')).toBeVisible();
      await expect(page.locator('text=ADMIN')).toBeVisible();
      await expect(page.locator('text=TEACHER')).toBeVisible();
      await expect(page.locator('text=PARENT')).toBeVisible();
    });

    test('should view audit logs', async ({ page }) => {
      await page.goto('/admin/audit-logs');
      await expect(page.locator('text=Audit Logs')).toBeVisible();
      await expect(page.locator('table')).toBeVisible();
    });
  });

  test.describe('Teacher role', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.fill('input[name="email"]', 'teacher@novastar.edu');
      await page.fill('input[name="password"]', 'TestPass123!');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*dashboard/);
    });

    test('should access teacher routes', async ({ page }) => {
      const teacherRoutes = [
        '/teacher/classes',
        '/teacher/students',
        '/teacher/assessments',
        '/teacher/attendance',
        '/teacher/grades'
      ];

      for (const route of teacherRoutes) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/.*unauthorized/);
      }
    });

    test('should NOT access admin routes', async ({ page }) => {
      const adminRoutes = [
        '/admin/users',
        '/admin/settings',
        '/admin/billing'
      ];

      for (const route of adminRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL(/.*unauthorized/);
      }
    });

    test('should manage assessments', async ({ page }) => {
      await page.goto('/teacher/assessments');
      await page.click('button:has-text("Create Assessment")');
      await page.fill('input[name="title"]', 'Math Quiz');
      await page.fill('textarea[name="description"]', 'Weekly math quiz');
      await page.fill('input[name="maxScore"]', '100');
      await page.click('button[type="submit"]');
      await expect(page.locator('text=Assessment created')).toBeVisible();
    });

    test('should record attendance', async ({ page }) => {
      await page.goto('/teacher/attendance');
      await page.selectOption('select[name="classId"]', 'class-123');
      await page.click('button:has-text("Mark Present")');
      await expect(page.locator('text=Attendance recorded')).toBeVisible();
    });
  });

  test.describe('Parent role', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.fill('input[name="email"]', 'parent@novastar.edu');
      await page.fill('input[name="password"]', 'TestPass123!');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*dashboard/);
    });

    test('should access parent routes', async ({ page }) => {
      const parentRoutes = [
        '/parent/children',
        '/parent/payments',
        '/parent/grades',
        '/parent/announcements',
        '/parent/calendar'
      ];

      for (const route of parentRoutes) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/.*unauthorized/);
      }
    });

    test('should NOT access teacher or admin routes', async ({ page }) => {
      const restrictedRoutes = [
        '/teacher/classes',
        '/admin/users',
        '/admin/settings'
      ];

      for (const route of restrictedRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL(/.*unauthorized/);
      }
    });

    test('should view child grades', async ({ page }) => {
      await page.goto('/parent/grades');
      await expect(page.locator('text=Student Grades')).toBeVisible();
      await expect(page.locator('table')).toBeVisible();
    });

    test('should view and pay invoices', async ({ page }) => {
      await page.goto('/parent/payments');
      await expect(page.locator('text=Fee Invoices')).toBeVisible();
      await page.click('table tbody tr:first-child button:has-text("Pay Now")');
      await expect(page.locator('text=Payment')).toBeVisible();
    });
  });

  test.describe('Student role', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.fill('input[name="email"]', 'student@novastar.edu');
      await page.fill('input[name="password"]', 'TestPass123!');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*dashboard/);
    });

    test('should access student routes', async ({ page }) => {
      const studentRoutes = [
        '/student/classes',
        '/student/assignments',
        '/student/grades',
        '/student/calendar'
      ];

      for (const route of studentRoutes) {
        await page.goto(route);
        await expect(page).not.toHaveURL(/.*unauthorized/);
      }
    });

    test('should NOT access parent, teacher, or admin routes', async ({ page }) => {
      const restrictedRoutes = [
        '/parent/children',
        '/teacher/classes',
        '/admin/users'
      ];

      for (const route of restrictedRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL(/.*unauthorized/);
      }
    });
  });

  test.describe('Cross-tenant isolation', () => {
    test('should not see data from other tenants', async ({ page }) => {
      await page.goto('/login');
      await page.fill('input[name="email"]', 'admin@tenant-a.edu');
      await page.fill('input[name="password"]', 'TestPass123!');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*dashboard/);

      await page.goto('/admin/users');
      const userCount = await page.locator('table tbody tr').count();
      
      await page.click('button[aria-label="User menu"]');
      await page.click('text=Sign out');

      await page.goto('/login');
      await page.fill('input[name="email"]', 'admin@tenant-b.edu');
      await page.fill('input[name="password"]', 'TestPass123!');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL(/.*dashboard/);

      await page.goto('/admin/users');
      const userCountB = await page.locator('table tbody tr').count();
      
      expect(userCount).not.toBe(userCountB);
    });
  });
});