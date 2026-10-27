import { expect, test } from '@playwright/test'

test.describe('Public website and authentication entry points', () => {
  test('desktop navigation exposes its dropdown when reached by keyboard', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/')
    await page.screenshot({ path: testInfo.outputPath('marketing-desktop.png'), fullPage: true })
    const navigation = page.getByRole('navigation', { name: 'Main', exact: true })
    await navigation.getByRole('link', { name: 'Discover', exact: true }).focus()
    await expect(navigation.getByText('Our history and mission')).toBeVisible()
    await expect(navigation.getByText('Our history and mission').locator('../../..')).toHaveCSS('opacity', '1')
    await page.keyboard.press('Tab')
    await expect(navigation.getByRole('link', { name: /Welcome/ })).toBeFocused()
  })

  test('mobile navigation keeps closed submenu links out of keyboard focus', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('marketing-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Open menu', exact: true }).click()
    const navigation = page.getByRole('navigation', { name: 'Mobile', exact: true })
    await expect(navigation.getByRole('link', { name: 'Welcome', exact: true })).toHaveCount(0)
    await navigation.getByRole('button', { name: 'Discover', exact: true }).click()
    await expect(navigation.getByRole('link', { name: 'Welcome', exact: true })).toBeVisible()
    await navigation.getByRole('button', { name: 'Discover', exact: true }).click()
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[inert]')))).toBe(false)
    }
  })

  test('footer calendar opens a real public page and unfinished social links stay hidden', async ({ page }) => {
    await page.goto('/')
    const footer = page.getByRole('contentinfo')
    await footer.getByRole('link', { name: 'Events & Calendar' }).click()
    await expect(page.getByRole('heading', { name: 'Events Calendar', exact: true })).toBeVisible()
    await expect(footer.getByRole('link', { name: /Facebook|Twitter|Instagram|YouTube/ })).toHaveCount(0)
  })

  test('password recovery opens without a session', async ({ page }) => {
    await page.goto('/portal/forgot-password/')
    await expect(page).toHaveURL(/\/portal\/forgot-password\/?$/)
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
  })

  test('admin login hydrates and includes the CSRF token on a credential request', async ({ page, context }) => {
    let sentToken: string | undefined
    await page.route('**/admin/api/auth/login', async route => {
      sentToken = route.request().headers()['x-csrf-token']
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Credentials were rejected for this test.' }) })
    })
    const response = await page.goto('/admin/login/')
    if (process.env.E2E_SERVER_MODE === 'production') {
      const csp = response?.headers()['content-security-policy'] ?? ''
      const nonce = csp.match(/'nonce-([^']+)'/)?.[1]
      expect(nonce).toBeTruthy()
      const scriptNonce = await page.locator('script[nonce]').first().evaluate(element => element instanceof HTMLScriptElement ? element.nonce : null)
      expect(scriptNonce).toBe(nonce)
    }
    const identifier = page.getByRole('textbox', { name: 'Username or email' })
    await expect(identifier).toBeEnabled()
    await identifier.fill('test-operator')
    await page.getByLabel('Password', { exact: true }).fill('deliberately-invalid-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByText('Credentials were rejected for this test.')).toBeVisible()
    const token = (await context.cookies()).find(cookie => cookie.name === 'csrf-token')?.value
    expect(token).toBeTruthy()
    expect(sentToken).toBe(token)
  })
})
