import type { MetadataRoute } from 'next'
import { SCHOOL_INFO } from '@/lib/metadata'

/*
 * Trailing slashes match `trailingSlash: true` in next.config.ts, so
 * these are the same URLs the pages declare as canonical in
 * `lib/metadata.ts`. A sitemap entry without the slash would advertise
 * a URL that 308-redirects to the slashed one — two URLs for one page.
 */
const routes = [
  '/',
  '/about/',
  '/academics/',
  '/admissions/',
  '/fees/',
  '/policies/',
  '/news/',
  '/events/',
  '/contact/',
] as const

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${SCHOOL_INFO.website}${route}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: route === '/' ? 1 : 0.8,
  }))
}