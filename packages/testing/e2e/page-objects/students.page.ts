import { Page } from '@playwright/test'
import { BasePage } from './base'

export class StudentsPage extends BasePage {
  private readonly table = '[data-testid="students-table"], table.students-table'
  private readonly row = (studentId: string) => `[data-testid="student-row-${studentId}"]`
  private readonly createButton = '[data-testid="create-student-btn"], button:has-text("Add Student")'
  private readonly searchInput = 'input[placeholder*="search" i], input[name="search"]'
  private readonly classFilter = 'select[name="classId"]'

  constructor(page: Page) {
    super(page)
  }

  async goto(): Promise<void> {
    await super.goto('/students')
  }

  async getStudentCount(): Promise<number> {
    await this.waitForSelector(this.table)
    return this.page.locator(`${this.table} tbody tr`).count()
  }

  async getStudentRow(studentId: string) {
    return this.page.locator(this.row(studentId))
  }

  async clickCreateStudent(): Promise<void> {
    await this.click(this.createButton)
    await this.page.waitForURL('**/students/new**')
  }

  async search(query: string): Promise<void> {
    await this.fill(this.searchInput, query)
    await this.page.waitForLoadState('networkidle')
  }

  async filterByClass(classId: string): Promise<void> {
    await this.page.selectOption(this.classFilter, classId)
    await this.page.waitForLoadState('networkidle')
  }

  async getStudentName(studentId: string): Promise<string> {
    const row = await this.getStudentRow(studentId)
    return (await row.locator('td').first().textContent()) ?? ''
  }
}