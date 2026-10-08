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
    // The portal is mounted under /portal (next.config.ts `basePath`), so its
    // auth API lives at /portal/api/auth. next-auth's client defaults its
    // basePath to /api/auth and never reads NEXTAUTH_URL in the browser
    // (Next.js exposes only NEXT_PUBLIC_* to client code), so the prefix has
    // to be stated here — otherwise every session, CSRF and sign-in call
    // would target /api/auth and 404 behind the basePath.
    <SessionProvider basePath="/portal/api/auth">
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        {children}
      </ThemeProvider>
    </SessionProvider>
  )
}
