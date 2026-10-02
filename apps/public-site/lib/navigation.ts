import messages from '@/messages/en.json'

/**
 * Navigation labels for the site.
 *
 * The site currently ships English-only. `messages/{en,tw}.json` exist as the
 * translation work product, but nothing consumes them yet: `output: 'export'`
 * rules out next-intl's middleware-based locale routing, and the Twi copy still
 * needs review by a native speaker before it is shown to parents.
 *
 * When i18n is wired, this module is the only place that changes — swap the
 * static import for `getTranslations` and add the locale switcher back to the
 * header.
 */
export interface NavigationLabels {
  home: string
  about: string
  academics: string
  admissions: string
  fees: string
  facilities: string
  news: string
  events: string
  gallery: string
  contact: string
  applyNow: string
}

export const navigation: NavigationLabels = messages.navigation