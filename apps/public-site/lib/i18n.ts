// apps/public-site/lib/i18n.ts

import { getRequestConfig } from 'next-intl/server'
import { locales, type Locale } from '../config/i18n'

export default getRequestConfig(async ({ locale }) => {
  const baseLocale = locale as Locale
  const localeToUse = locales.includes(baseLocale) ? baseLocale : (process.env.DEFAULT_LOCALE as Locale)

  const messages = (await import(`../messages/${localeToUse}.json`)).default

  return {
    messages,
    locale: localeToUse,
  }
})

export { locales }