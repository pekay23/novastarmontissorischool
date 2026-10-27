'use client'

import { useEffect } from "react"

import { DevToolsGuard } from "./DevToolsGuard"
import { preventDefaultHandler } from "./client-guards"

/**
 * Composition root for client-side security deterrents.
 */
export function SecurityShield() {
  useEffect(() => {
    if (typeof document === "undefined") return

    const shieldEnabled = process.env.NEXT_PUBLIC_SECURITY_SHIELD === "1"
    const htmlElement = document.documentElement

    if (shieldEnabled) {
      htmlElement.dataset.securityShield = "strict"
    }

    const captureOptions = { capture: true } as const

    document.addEventListener("contextmenu", preventDefaultHandler, captureOptions)
    document.addEventListener("dragstart", preventDefaultHandler, captureOptions)
    document.addEventListener("selectstart", preventDefaultHandler, captureOptions)

    return () => {
      document.removeEventListener("contextmenu", preventDefaultHandler, captureOptions)
      document.removeEventListener("dragstart", preventDefaultHandler, captureOptions)
      document.removeEventListener("selectstart", preventDefaultHandler, captureOptions)
    }
  }, [])

  return <DevToolsGuard />
}