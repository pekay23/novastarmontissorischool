import { Page, Locator } from '@playwright/test'

export class BasePage {
  constructor(protected page: Page) {}

  async goto(path: string): Promise<void> {
    await this.page.goto(path)
    await this.page.waitForLoadState('networkidle')
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<Locator> {
    const locator = this.page.locator(selector)
    await locator.waitFor({ state: 'visible', timeout: options?.timeout ?? 7000 })
    return locator
  }

  async click(selector: string): Promise<void> {
    await this.page.click(selector)
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value)
  }

  async getText(selector: string): Promise<string> {
    return (await this.page.textContent(selector)) ?? ''
  }

  async isVisible(selector: string): Promise<boolean> {
    return this.page.locator(selector).isVisible()
  }
}