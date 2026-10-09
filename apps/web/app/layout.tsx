import './globals.css'

import { baseMetadata } from '@/lib/metadata'
import { ToastProvider } from '@novastar/shared-ui'
import { Plus_Jakarta_Sans, Playfair_Display } from 'next/font/google'

/*
 * Root layout of the merged app (ADR-024): one `<html>` for the
 * marketing site, the portal and the console. It deliberately renders
 * no chrome of its own — the marketing shell (header, footer) lives in
 * app/(public)/layout.tsx, the portal shell in app/portal/layout.tsx,
 * the operator shell in app/admin/layout.tsx. A section layout wraps
 * only its own subtree, so no page ever renders two shells.
 *
 * Real webfonts. next/font downloads at build time and self-hosts,
 * which matters because the marketing pages are prerendered: no
 * runtime call to Google.
 *
 * The pairing is the one named by the site's Stitch design system:
 * Playfair Display for display and headline settings and Plus Jakarta
 * Sans for all body, label and UI text.
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
      /*
       * `globals.css` sets `scroll-behavior: smooth` on this element,
       * and Next.js warned about exactly that combination on every dev
       * request:
       *
       *   Detected `scroll-behavior: smooth` on the `<html>` element.
       *   To disable smooth scrolling during route transitions, add
       *   `data-scroll-behavior="smooth"` to your `<html>` element.
       *
       * Without it, a client-side navigation waits out the previous
       * scroll animation before starting the new one. With it, Next.js
       * switches the behaviour to `auto` for the duration of the
       * transition and restores smooth scrolling afterwards.
       */
      data-scroll-behavior="smooth"
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        {/* Tracks --color-primary. Kept in sync with app/globals.css. */}
        <meta name="theme-color" content="#6a019f" />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
