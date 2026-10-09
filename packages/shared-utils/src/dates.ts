// Date Formatting

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