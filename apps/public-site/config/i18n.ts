// apps/public-site/config/i18n.ts
export const locales = ['en', 'tw'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'en'
export const localePrefix = 'always' // Prefix all locales

export const localeNames: Record<Locale, string> = {
  en: 'English',
  tw: 'Twi',
}

// Navigation labels from messages
export const navigationKeys = {
  home: 'navigation.home',
  about: 'navigation.about',
  academics: 'navigation.academics',
  admissions: 'navigation.admissions',
  fees: 'navigation.fees',
  facilities: 'navigation.facilities',
  news: 'navigation.news',
  events: 'navigation.events',
  gallery: 'navigation.gallery',
  contact: 'navigation.contact',
  applyNow: 'navigation.applyNow',
  languageToggle: 'navigation.languageToggle',
} as const