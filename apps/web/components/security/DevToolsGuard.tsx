'use client'

import { useEffect } from "react"

import { createDevToolsDetector, logSecurityEvent } from "./client-guards"

/**
 * Client component that detects DevTools opening and optionally traps it
 * when enabled via environment variable.
 */
export function DevToolsGuard(): null {
  useEffect(() => {
    const trapEnabled = process.env.NEXT_PUBLIC_SECURITY_DEVTOOLS_TRAP === "1"
    const detector = createDevToolsDetector({ trap: trapEnabled })

    const unsubscribe = detector.onChange((open) => {
      if (typeof document !== "undefined") {
        document.documentElement.dataset.securityDevtools = open ? "open" : "closed"
      }
      logSecurityEvent(open ? "devtools.open" : "devtools.closed")
    })

    detector.start()

    return () => {
      detector.stop()
      unsubscribe()
    }
  }, [])

  return null
}