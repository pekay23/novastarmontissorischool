'use client'

import { ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from 'next-themes'
// Side-effect import: installs the CSRF token on same-origin API writes for the
// whole client tree. Imported here, at the client root, rather than in each of
// the ~25 components that call fetch, so no call site can be missed. See
// lib/security/csrf-client.ts.
import '@/lib/security/csrf-client'

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        {children}
      </ThemeProvider>
    </SessionProvider>
  )
}
