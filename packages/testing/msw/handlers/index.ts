export { authHandlers } from './auth'
export { studentHandlers } from './students'
export { financeHandlers } from './finance'
export { notificationHandlers } from './notifications'

import { authHandlers } from './auth'
import { studentHandlers } from './students'
import { financeHandlers } from './finance'
import { notificationHandlers } from './notifications'

export const handlers = [
  ...authHandlers,
  ...studentHandlers,
  ...financeHandlers,
  ...notificationHandlers,
]