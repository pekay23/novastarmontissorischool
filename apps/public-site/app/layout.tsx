import './globals.css'

import { baseMetadata, SCHOOL_INFO } from '@/lib/metadata'
import { navigation } from '@/lib/navigation'
import { ToastProvider } from '@novastar/shared-ui'
import { Plus_Jakarta_Sans, Playfair_Display } from 'next/font/google'
import Header from '@/components/header'
import { Footer } from '@/components/footer'

/*
 * Real webfonts. next/font downloads at build time and self-hosts, which
 * matters here because this site is a static export: no runtime call to Google.
 *
 * The pairing is the one named by the site's Stitch design system: Playfair
 * Display for display and headline settings (editorial serif, italic available
 * for the emphasised spans the design leans on) and Plus Jakarta Sans for all
 * body, label and UI text. Plus Jakarta Sans replaced Mulish here; the design
 * specifies it and Mulish's rounded terminals read too soft next to the serif.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800'],
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
})

export const metadata = baseMetadata

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${playfair.variable}`}
    >
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
        {/* Tracks --color-primary. Kept in sync with app/globals.css. */}
        <meta name="theme-color" content="#5a1121" />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToastProvider>
          <div className="min-h-screen flex flex-col">
            {/* The main landmark is focusable but nothing links to it, so a
                keyboard user otherwise tabs through the whole header on every
                page before reaching the content. */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-medium focus:text-primary-foreground"
            >
              Skip to main content
            </a>
            {/*
              Contact details are passed in rather than imported by the header
              itself. `Header` is a client component, and importing `SCHOOL_INFO`
              from the metadata module would pull the whole module — including
              the `new URL()` in `baseMetadata` — into the browser bundle just to
              read a phone number. This also keeps the opening hours single-sourced
              as `lib/metadata.ts` requires.
            */}
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
        </ToastProvider>
      </body>
    </html>
  )
}