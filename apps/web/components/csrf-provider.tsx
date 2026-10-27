'use client'

import type { ReactNode } from 'react'
import '@/lib/security/csrf-client'

export function CsrfProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
