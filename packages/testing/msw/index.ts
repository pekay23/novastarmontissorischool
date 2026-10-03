import { setupServer } from 'msw/node'
import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export function createTestServer() {
  return setupServer(...handlers)
}

export function createTestWorker() {
  return setupWorker(...handlers)
}

export { handlers } from './handlers'