'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger

/**
 * Refcounted scroll lock for the portal's inner scroll container.
 *
 * Radix's `react-remove-scroll` only locks `document.body`. The portal scrolls
 * an inner `<main data-portal-scroll>` element, so without this the content
 * behind a dialog stays scrollable and the dialog itself can be scrolled off
 * screen. Track every mounted DialogContent; while at least one is open, hold
 * `overflow: hidden` on each `[data-portal-scroll]` element and restore the
 * previous inline value when the last dialog closes. No matching element => no
 * work done, so this is a no-op for apps that do not use the portal scroll
 * container (admin console, public site).
 */
const portalScrollLocks = new Map<HTMLElement, { prevOverflow: string; count: number }>()

function lockPortalScrolls() {
  if (typeof document === 'undefined') return
  document.querySelectorAll<HTMLElement>('[data-portal-scroll]').forEach((el) => {
    const entry = portalScrollLocks.get(el)
    if (entry) {
      entry.count += 1
      return
    }
    portalScrollLocks.set(el, { prevOverflow: el.style.overflow, count: 1 })
    el.style.overflow = 'hidden'
  })
}

function unlockPortalScrolls() {
  if (typeof document === 'undefined') return
  portalScrollLocks.forEach((entry, el) => {
    entry.count -= 1
    if (entry.count > 0) return
    el.style.overflow = entry.prevOverflow
    portalScrollLocks.delete(el)
  })
}

/**
 * Renders children inside `DialogPortal`, whose subtree Radix gates with
 * `Presence` on the dialog's open state. The lock effect must live here
 * rather than in `DialogContent` itself: `DialogContent` mounts whenever
 * its parent renders it — `ConfirmProvider` renders it with
 * `open={false}` on every page — so an effect on the wrapper would lock
 * the scroll container for the whole session instead of only while a
 * dialog is up.
 */
function PortalScrollLock() {
  React.useEffect(() => {
    lockPortalScrolls()
    return () => {
      unlockPortalScrolls()
    }
  }, [])
  return null
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  return (
    <DialogPortal {...props}>
      <DialogOverlay />
      <PortalScrollLock />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <button className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold', className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

// Need to add DialogPortal and DialogOverlay
const DialogClose = DialogPrimitive.Close
const DialogPortal = ({ children, ...props }: DialogPrimitive.DialogPortalProps) => (
  <DialogPrimitive.Portal {...props}>{children}</DialogPrimitive.Portal>
)
DialogPortal.displayName = DialogPrimitive.Portal.displayName

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out', className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
}
