import { Page } from '@playwright/test'
import { BasePage } from './base'

export class LoginPage extends BasePage {
  private readonly emailInput = 'input[name="email"], input[type="email"]'
  private readonly passwordInput = 'input[name="password"], input[type="password"]'
  private readonly schoolCodeInput = 'input[name="schoolCode"]'
  private readonly totpInput = 'input[name="totpCode"]'
  private readonly submitButton = 'button[type="submit"]'
  private readonly errorMessage = '[data-testid="error-message"], .error-message, .alert-error'

  constructor(page: Page) {
    super(page)
  }

  async goto(): Promise<void> {
    await super.goto('/login')
  }

  async signIn(email: string, password: string, schoolCode?: string): Promise<void> {
    await this.fill(this.emailInput, email)
    await this.fill(this.passwordInput, password)
    if (schoolCode) {
      await this.fill(this.schoolCodeInput, schoolCode)
    }
    await this.click(this.submitButton)
    await this.page.waitForURL('**/dashboard**', { timeout: 15000 })
  }

  async signInWith2FA(email: string, password: string, totpCode: string): Promise<void> {
    await this.fill(this.emailInput, email)
    await this.fill(this.passwordInput, password)
    await this.click(this.submitButton)
    await this.waitForSelector(this.totpInput)
    await this.fill(this.totpInput, totpCode)
    await this.click(this.submitButton)
    await this.page.waitForURL('**/dashboard**', { timeout: 15000 })
  }

  async getErrorMessage(): Promise<string> {
    return this.getText(this.errorMessage)
  }

  async hasError(): Promise<boolean> {
    return this.isVisible(this.errorMessage)
  }
}