import { chromium, type FullConfig } from '@playwright/test'
import { LoginPage } from './page-objects/login.page'
import { existsSync } from 'fs'
import { join } from 'path'

const STORAGE_STATE_PATH = join(process.cwd(), 'e2e', 'storageState.json')

export async function createStorageState(): Promise<void> {
  const email = process.env.E2E_EMAIL
  const password = process.env.E2E_PASSWORD

  if (!email || !password) {
    console.log('[storage-state] E2E_EMAIL or E2E_PASSWORD not set, skipping storage state creation')
    return
  }

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  const login = new LoginPage(page)
  await login.goto()
  await login.signIn(email, password)

  await context.storageState({ path: STORAGE_STATE_PATH })
  await browser.close()

  console.log('[storage-state] Created storage state at', STORAGE_STATE_PATH)
}

export function hasCredentials(): boolean {
  return Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD)
}

export function getStorageStatePath(): string | undefined {
  if (!hasCredentials()) return undefined
  if (!existsSync(STORAGE_STATE_PATH)) return undefined
  return STORAGE_STATE_PATH
}

export default async function globalSetup(config: FullConfig) {
  await createStorageState()
}