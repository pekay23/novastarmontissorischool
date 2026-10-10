import type { Metadata } from 'next'
import '../admin.css'

/**
 * The console section layout (ADR-024).
 *
 * Renders no `<html>` and no `<body>`. The merged root layout
 * (app/layout.tsx) owns those for every section — marketing site,
 * portal and console alike. A nested `<html>`/`<body>` pair here
 * is invalid HTML nesting: the browser drops the inner tags while
 * parsing, so the server-rendered document and the client's
 * hydration tree disagree about the attributes of the real `<html>`
 * and `<body>` — a hydration mismatch on every console page, first
 * seen at `/admin/login`.
 *
 * No `ThemeProvider` and no dark-mode toggle: this console is a
 * light-mode-only surface by choice, so nothing here sets a `.dark`
 * class. `globals.css` still defines the dark tokens so a shared-ui
 * component that ships a dark variant degrades to its light one
 * instead of to nothing. The root layout's `ToastProvider` wraps
 * this subtree; toasts stay inert until something reads them.
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

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
