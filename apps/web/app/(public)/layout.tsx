import { SCHOOL_INFO } from '@/lib/metadata'
import { navigation } from '@/lib/navigation'
import Header from '@/components/header'
import { Footer } from '@/components/footer'

/*
 * Marketing shell (ADR-024). This is a nested layout, so it
 * renders no `<html>`, no fonts and no metadata — the root
 * layout (app/layout.tsx) owns those. It wraps only the
 * marketing pages (app/(public)/*) with the site header and
 * footer; the portal (app/portal) and the console
 * (app/admin) are separate subtrees with their own shells and
 * never see this chrome.
 *
 * Contact details are passed in rather than imported by the
 * header itself. `Header` is a client component, and importing
 * `SCHOOL_INFO` from the metadata module would pull the whole
 * module — including the `new URL()` in `baseMetadata` — into
 * the browser bundle just to read a phone number. This also
 * keeps the opening hours single-sourced as `lib/metadata.ts`
 * requires.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/*
        The main landmark is focusable but nothing links to it,
        so a keyboard user otherwise tabs through the whole
        header on every page before reaching the content.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-medium focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <Header
        navigation={navigation}
        siteName={SCHOOL_INFO.name}
        contact={{
          phone: SCHOOL_INFO.phone,
          phoneHref: SCHOOL_INFO.phoneHref,
          email: SCHOOL_INFO.email,
          weekdayHours: SCHOOL_INFO.hours[0].time,
        }}
      />
      <main id="main-content" className="flex-1" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  )
}
