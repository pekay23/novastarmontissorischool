import type { Metadata } from 'next'
import '../admin.css'

/**
 * The root layout.
 *
 * No `ThemeProvider` from `@novastar/shared-ui`, and no dark-mode toggle: this
 * console is a light-mode-only surface by choice, so nothing here sets a `.dark`
 * class. `globals.css` still defines the dark tokens so a shared-ui component that
 * ships a dark variant degrades to its light one instead of to nothing.
 *
 * `suppressHydrationWarning` is on `<body>` because the shell writes a theme-free
 * document and Next's dev overlay injects an attribute of its own.
 */
export const metadata: Metadata = {
  title: {
    default: 'Novastar Platform Console',
    template: '%s — Novastar Platform Console',
  },
  // A control plane must never be indexed, and `robots.txt` is not worth a route
  // for: the header below is the same instruction, delivered to anything that
  // asks.
  robots: { index: false, follow: false, nocache: true },
  referrer: 'origin-when-cross-origin',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
