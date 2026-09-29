// ============================================================================
// Shared Utilities — Currency, Dates, Validation Helpers
// ============================================================================

import { format, parseISO, isValid, formatDistanceToNow } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'

// --- Custom Twi locale (date-fns doesn't ship a Twi locale) ---
// Falls back to English formatting until full Twi locale data is provided.
// https://date-fns.org/v4.1.0/docs/Locale
const tw: Locale = {
  ...enUS,
  code: 'tw',
}

// --- Currency (Ghana Cedis) ---

export function formatGHS(amount: number | string | null | undefined): string {
  const num = parseFloat(String(amount || 0))
  if (isNaN(num)) return '₵0.00'
  return `₵${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[₵,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

export function formatPhone(phone: string): string {
  // Ghana phone number formatting: +233 55 441 6937
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 9 && cleaned.startsWith('0')) {
    return `+233 ${cleaned.slice(1, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`
  }
  if (cleaned.length === 12 && cleaned.startsWith('233')) {
    return `+233 ${cleaned.slice(3, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`
  }
  return phone
}

// --- Date Formatting ---

export type LocaleType = 'en' | 'tw'

export function formatDate(date: Date | string | null | undefined, locale: LocaleType = 'en'): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'

  const loc = locale === 'tw' ? tw : enUS
  return format(d, 'PP', { locale: loc })
}

export function formatDateTime(date: Date | string | null | undefined, locale: LocaleType = 'en'): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? parseISO(date) : date
  if (!isValid(d)) return '—'

  const loc = locale === 'tw' ? tw : enUS
  return format(d, 'PPpp', { locale: loc })
}

export function timeAgo(date: Date | string | null | undefined, locale: LocaleType = 'en'): string {
  if (!date) return '—'
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(d)) return '—'

    const loc = locale === 'tw' ? tw : enUS
    return formatDistanceToNow(d, { addSuffix: true, locale: loc })
  } catch {
    return '—'
  }
}

export function formatDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  locale: LocaleType = 'en'
): string {
  return `${formatDate(start, locale)} — ${formatDate(end, locale)}`
}

// --- ID Generation ---

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function generateStudentId(year: number, sequence: number): string {
  const yy = String(year).slice(-2)
  const seq = String(sequence).padStart(3, '0')
  return `NOVA${yy}${seq}`
}

export function generateInvoiceNumber(year: number, sequence: number): string {
  const yy = String(year).slice(-2)
  const seq = String(sequence).padStart(4, '0')
  return `INV${yy}${seq}`
}

// --- Validation Helpers ---

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function validateGhanaPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '')
  return (cleaned.length === 9 && cleaned.startsWith('0')) ||
         (cleaned.length === 12 && cleaned.startsWith('233'))
}

export function validateGhanaID(id: string): boolean {
  // Ghanaian ID: 10 or 12 digits
  const cleaned = id.replace(/\D/g, '')
  return cleaned.length === 10 || cleaned.length === 12
}

// --- Percentage Calculations ---

export function calculatePercentage(marks: number, total: number): number {
  if (total === 0) return 0
  return Math.round((marks / total) * 100 * 100) / 100
}

export function calculateAverage(scores: number[]): number {
  if (scores.length === 0) return 0
  return scores.reduce((sum, s) => sum + s, 0) / scores.length
}

export function calculateWeightedAverage(
  items: Array<{ score: number; weight: number }>,
  defaultWeight: number = 1
): number {
  const totalWeight = items.reduce((sum, i) => sum + (i.weight || defaultWeight), 0)
  if (totalWeight === 0) return 0
  const weightedSum = items.reduce((sum, i) => sum + (i.score * (i.weight || defaultWeight)), 0)
  return weightedSum / totalWeight
}

// --- Grade Calculation ---

export function determineGrade(
  percentage: number,
  gradingScale: Array<{ minScore: number; maxScore: number; key: string; label: string }>
): { grade: string; key: string; label: string } | null {
  const matched = gradingScale.find(
    level => percentage >= level.minScore && percentage <= level.maxScore
  )
  if (!matched) {
    // Fallback: find closest
    const below = gradingScale.filter(l => percentage >= l.minScore).sort((a, b) => b.minScore - a.minScore)
    if (below.length > 0) {
      const match = below[0]!
      return { grade: match.label, key: match.key, label: match.label }
    }
    return null
  }
  return { grade: matched.label, key: matched.key, label: matched.label }
}

// --- Attendance Calculation ---

export function calculateAttendancePercentage(
  present: number,
  total: number
): { percentage: number; colour: string } {
  if (total === 0) return { percentage: 0, colour: 'gray' }
  const pct = Math.round((present / total) * 100)
  
  let colour = 'green'
  if (pct < 75) colour = 'red'
  else if (pct < 85) colour = 'amber'
  
  return { percentage: pct, colour }
}

// --- Truncation ---

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// --- Deep Clone ---

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// --- Debounce ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- debounce requires any[] for generic function args
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }
}

// --- Retry ---

export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt))
      }
    }
  }
  throw lastError!
}