'use client'

import { useEffect } from 'react'

/*
 * Pointer parallax for the hero stack.
 *
 * This component renders nothing. It exists only to write two custom properties
 * onto the stage element, which the `hero-plane-*` utilities in `globals.css`
 * read. Keeping it a null-rendering leaf means `app/page.tsx` stays a server
 * component and no extra JavaScript lands in the page's own module graph.
 *
 * Three decisions worth stating, because each is a trade:
 *
 * 1. NO LISTENER AT ALL under `prefers-reduced-motion: reduce`. Not a listener
 *    that writes zeros — no listener. The `hero-plane-*` utilities default
 *    `--px`/`--py` to 0, so the composition a reduced-motion user gets is
 *    byte-identical to the one a JavaScript-disabled visitor gets. That is the
 *    only way to be sure the two match, and it also means there is no rAF loop
 *    burning battery on a device that asked us to stop animating.
 *
 * 2. rAF-coalesced, and it writes to CSS custom properties rather than to
 *    element styles directly. A pointermove can fire more often than the display
 *    refreshes; scheduling one frame write collapses those into at most one
 *    style mutation per frame, and the browser keeps the work on the compositor
 *    because only `transform` consumes the values.
 *
 * 3. Clamped, and it stops at the edges. Unclamped pointer tracking on a wide
 *    stage moves the planes far enough to expose their own edges, which is the
 *    single most common way a parallax hero gives itself away.
 */

/** Travel in px at full deflection, at the 1x pointer scale. */
const MAX_SHIFT = 26

/** Deflection beyond this fraction of the stage size is ignored. */
const EDGE_ZONE = 0.08

export function HeroParallax({ stageId }: { stageId: string }) {
  useEffect(() => {
    const stage = document.getElementById(stageId)
    if (!stage) return

    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (query.matches) return

    // A coarse pointer has no hover and no steady position, so there is nothing
    // to track. Skipping here also avoids a listener that fires on every touch
    // drag and fights the page's own scrolling.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0
    let nextX = 0
    let nextY = 0

    const flush = () => {
      frame = 0
      stage.style.setProperty('--px', nextX.toFixed(3))
      stage.style.setProperty('--py', nextY.toFixed(3))
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      // -0.5..0.5 from the stage centre.
      const dx = (event.clientX - rect.left) / rect.width - 0.5
      const dy = (event.clientY - rect.top) / rect.height - 0.5

      // Clamp toward the centre so the planes never travel far enough to reveal
      // the stage edge.
      const clamp = (v: number) => {
        const limit = 0.5 - EDGE_ZONE
        if (v > limit) return limit
        if (v < -limit) return -limit
        return v
      }

      nextX = (clamp(dx) / (0.5 - EDGE_ZONE)) * (MAX_SHIFT / 16)
      nextY = (clamp(dy) / (0.5 - EDGE_ZONE)) * (MAX_SHIFT / 16)

      if (frame === 0) frame = requestAnimationFrame(flush)
    }

    const reset = () => {
      nextX = 0
      nextY = 0
      if (frame === 0) frame = requestAnimationFrame(flush)
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerleave', reset, { passive: true })
    window.addEventListener('blur', reset)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', reset)
      window.removeEventListener('blur', reset)
      if (frame !== 0) cancelAnimationFrame(frame)
      // Clear the properties so a remount does not start mid-deflection.
      stage.style.removeProperty('--px')
      stage.style.removeProperty('--py')
    }
  }, [stageId])

  return null
}
