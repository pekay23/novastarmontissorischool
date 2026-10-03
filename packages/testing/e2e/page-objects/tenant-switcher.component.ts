import { Page } from '@playwright/test'
import { BasePage } from './base'

export class TenantSwitcher extends BasePage {
  private readonly trigger = '[data-testid="tenant-switcher-trigger"], button:has-text("Tenant")'
  private readonly dropdown = '[data-testid="tenant-switcher-dropdown"], [role="listbox"]'
  private readonly option = (tenantCode: string) => `[data-testid="tenant-option-${tenantCode}"], [role="option"]:has-text("${tenantCode}")`

  constructor(page: Page) {
    super(page)
  }

  async open(): Promise<void> {
    await this.click(this.trigger)
    await this.waitForSelector(this.dropdown)
  }

  async selectTenant(tenantCode: string): Promise<void> {
    await this.open()
    await this.click(this.option(tenantCode))
    await this.page.waitForLoadState('networkidle')
  }

  async getCurrentTenant(): Promise<string> {
    return this.getText(this.trigger)
  }

  async getAvailableTenants(): Promise<string[]> {
    await this.open()
    const options = this.page.locator('[role="option"]')
    const count = await options.count()
    const tenants: string[] = []
    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent()
      if (text) tenants.push(text.trim())
    }
    return tenants
  }
}