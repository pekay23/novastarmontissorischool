import './globals.css'

import { baseMetadata } from '@/lib/metadata'
import { navigation } from '@/lib/navigation'
import { ToastProvider } from '@novastar/shared-ui'
import { Mulish, Playfair_Display } from 'next/font/google'
import Header from '@/components/header'
import { Footer } from '@/components/footer'

/*
 * Real webfonts. next/font downloads at build time and self-hosts, which
 * matters here because this site is a static export: no runtime call to Google.
 * Mulish is the body face (clean, slightly rounded, screen-friendly) and
 * Playfair Display is the headline face (editorial serif with italic variants)
 * — matching the homepage concept's chosen v1 pairing.
 */
const mulish = Mulish({
  subsets: ['latin'],
  variable: '--font-mulish',
  display: 'swap',
  weight: ['400', '600', '700'],
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
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
      className={`${mulish.variable} ${playfair.variable}`}
    >
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
        <meta name="theme-color" content="#5F1989" />
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
            <Header navigation={navigation} />
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