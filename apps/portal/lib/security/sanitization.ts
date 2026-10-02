/**
 * HTML and input sanitization utilities.
 *
 * Adopted from Aerojet Academy's `lib/security/sanitization.ts`.
 */

export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

export function sanitizeInput(input: string): string {
  return input.trim().replace(/[\x00-\x1F\x7F]/g, '')
}

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function sanitizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '')
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const sanitized = { ...obj }
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'string') {
      ;(sanitized as Record<string, unknown>)[key] = sanitizeInput(value)
    }
  }
  return sanitized
}
