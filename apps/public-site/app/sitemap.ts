import type { MetadataRoute } from 'next'
import { SCHOOL_INFO } from '@/lib/metadata'

const routes = [
  '',
  '/about',
  '/academics',
  '/admissions',
  '/fees',
  '/policies',
  '/news',
  '/events',
  '/contact',
] as const

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${SCHOOL_INFO.website}${route}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: route === '' ? 1 : 0.8,
  }))
}