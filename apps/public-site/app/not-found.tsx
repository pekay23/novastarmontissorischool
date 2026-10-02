import Link from 'next/link'
import { SCHOOL_INFO } from '@/lib/metadata'
import { ArrowLeft } from 'lucide-react'

export const metadata = {
  // Bare title: the layout's `%s | Novastar Montessori School` template appends
  // the suffix, so adding the school name here would double it.
  title: 'Page not found',
  description: 'The page you are looking for could not be found.',
  alternates: { canonical: SCHOOL_INFO.website },
}

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="container max-w-2xl text-center">
        <h1 className="text-responsive-h1 font-heading text-primary mb-4">404 — Page not found</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
          The page you are looking for could not be found. It may have been moved or no longer exists.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-3 text-base font-medium text-foreground transition-colors hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Go back home
        </Link>
      </div>
    </div>
  )
}