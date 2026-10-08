import type { MetadataRoute } from 'next'
import { SCHOOL_INFO } from '@/lib/metadata'

/* Required by `output: 'export'` — without it Next refuses to prerender this
   route and the build fails on "Failed to collect page data". */
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SCHOOL_INFO.website}/sitemap.xml`,
  }
}