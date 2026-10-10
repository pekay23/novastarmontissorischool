import { NotFound } from '@novastar/shared-ui'
import { SCHOOL_INFO } from '@/lib/metadata'

/*
 * The public-site renders the shared `NotFound` with its own title and
 * description, but delegates the layout, icon, and action button to the
 * shared component. This site has no `basePath`, so the default plain-`<a>`
 * action is correct here — no `next/link` is needed.
 */
export const metadata = {
  title: 'Page not found',
  description: 'The page you are looking for could not be found.',
  alternates: { canonical: SCHOOL_INFO.website },
  robots: { index: false, follow: false },
}

export default function NotFoundPage() {
  return (
    <NotFound
      title="404 — Page not found"
      description="The page you are looking for could not be found. It may have been moved or no longer exists."
    />
  )
}
