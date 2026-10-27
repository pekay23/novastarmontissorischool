/**
 * Client-side security guards (deterrents, not a security boundary).
 * All window/document access is guarded with typeof checks and the module
 * accepts an optional windowLike parameter for unit-testability.
 */

import { logWarn } from "@/lib/logger"

export type WindowLike = Window & typeof globalThis

export interface DevToolsDetectorOptions {
  intervalMs?: number
  widthThreshold?: number
  heightThreshold?: number
  trap?: boolean
  windowLike?: WindowLike | null
}

export interface DevToolsDetector {
  start(): void
  stop(): void
  readonly isOpen: boolean
  onChange(cb: (open: boolean) => void): () => void
}

/**
 * Check if a keyboard shortcut should be blocked.
 */
export function isBlockedShortcut(event: KeyboardEvent): boolean {
  const ctrlOrMeta = event.ctrlKey || event.metaKey

  // F12
  if (event.key === "F12") {
    return true
  }

  // Ctrl+Shift+I/J/C/K/U
  if (ctrlOrMeta && event.shiftKey) {
    if (event.key === "I" || event.key === "i") return true
    if (event.key === "J" || event.key === "j") return true
    if (event.key === "C" || event.key === "c") return true
    if (event.key === "K" || event.key === "k") return true
    if (event.key === "U" || event.key === "u") return true
    if (event.key === "S" || event.key === "s") return true
  }

  // Ctrl+U
  if (ctrlOrMeta && !event.shiftKey && !event.altKey) {
    if (event.key === "U" || event.key === "u") return true
  }

  // Ctrl+S
  if (ctrlOrMeta && !event.shiftKey && !event.altKey) {
    if (event.key === "S" || event.key === "s") return true
  }

  // Ctrl+P
  if (ctrlOrMeta && !event.shiftKey && !event.altKey) {
    if (event.key === "P" || event.key === "p") return true
  }

  // Ctrl+Shift+S
  if (ctrlOrMeta && event.shiftKey) {
    if (event.key === "S" || event.key === "s") return true
  }

  return false
}/**
 * Create a preventDefault handler for DOM events.
 */
export function preventDefaultHandler(event: Event): void {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault()
  }
}

/**
 * Log a security event via the application logger.
 */
export function logSecurityEvent(event: string, detail?: unknown): void {
  logWarn("[security]", event, detail !== undefined ? { detail } : undefined)
}

/**
 * Create a DevTools detection mechanism.
 */
export function createDevToolsDetector(opts: DevToolsDetectorOptions = {}): DevToolsDetector {
  const {
    intervalMs = 500,
    widthThreshold = 160,
    heightThreshold = 100,
    trap = false,
    windowLike = typeof window !== "undefined" ? (window as WindowLike) : null,
  } = opts

  let intervalId: ReturnType<typeof setInterval> | null = null
  let trapIntervalId: ReturnType<typeof setInterval> | null = null
  let openState = false
  const listeners = new Set<(open: boolean) => void>()

  function setOpenState(next: boolean): void {
    if (next === openState) return
    openState = next
    listeners.forEach((cb) => {
      try {
        cb(next)
      } catch {
        // ignore listener errors
      }
    })
  }

  function isOpenNow(): boolean {
    if (!windowLike || typeof windowLike.outerWidth === "undefined" || typeof windowLike.innerWidth === "undefined") {
      return false
    }
    if (
      typeof windowLike.outerHeight === "undefined" ||
      typeof windowLike.innerHeight === "undefined"
    ) {
      return false
    }

    const widthDiff = windowLike.outerWidth - windowLike.innerWidth
    const heightDiff = windowLike.outerHeight - windowLike.innerHeight

    return widthDiff > widthThreshold || heightDiff > heightThreshold
  }

  function startTrap(): void {
    if (trapIntervalId !== null) return
    try {
      trapIntervalId = setInterval(() => {
        debugger
      }, 100)
    } catch {
      // ignore trap setup errors
    }
  }

  function stopTrap(): void {
    if (trapIntervalId !== null) {
      clearInterval(trapIntervalId)
      trapIntervalId = null
    }
  }

  function start(): void {
    if (intervalId !== null) return

    setOpenState(isOpenNow())

    intervalId = setInterval(() => {
      const open = isOpenNow()
      setOpenState(open)

      if (trap && open) {
        startTrap()
      } else if (trap && !open) {
        stopTrap()
      }
    }, intervalMs)

    if (trap && isOpenNow()) {
      startTrap()
    }
  }

  function stop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId)
      intervalId = null
    }
    stopTrap()
    listeners.clear()
  }

  function onChange(cb: (open: boolean) => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }



  return {
    start,
    stop,
    get isOpen(): boolean {
      return openState
    },
    onChange,
  }
}