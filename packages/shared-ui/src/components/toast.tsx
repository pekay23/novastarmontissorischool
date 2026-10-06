'use client'

import * as React from 'react'
import { cn } from '../lib/utils'

const Toast = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'group pointer-events-auto flex w-full cursor-pointer gap-2 rounded-md border p-3 shadow-lg',
      className
    )}
    {...props}
  />
))
Toast.displayName = 'Toast'

const ToastAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => (
    <button ref={ref} className={cn('ml-auto shrink-0', className)} {...props} />
  )
)
ToastAction.displayName = 'ToastAction'

const ToastClose = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => (
    <button ref={ref} className={cn('ml-auto shrink-0', className)} {...props} />
  )
)
ToastClose.displayName = 'ToastClose'

const ToastTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('font-semibold', className)} {...props} />
  )
)
ToastTitle.displayName = 'ToastTitle'

const ToastDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm opacity-90', className)} {...props} />
  )
)
ToastDescription.displayName = 'ToastDescription'

const ToastFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-2 flex gap-2', className)} {...props} />
  )
)
ToastFooter.displayName = 'ToastFooter'

const ToastHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('grid gap-1', className)} {...props} />
  )
)
ToastHeader.displayName = 'ToastHeader'

/*
 * Not the rendered path. Every application in this monorepo raises toasts
 * through `PortalToastProvider` (exported as `ToastProvider`), which renders
 * `Toaster`/`ToastItem` in `use-toast.tsx`; `git grep -n ToastViewport` finds
 * no renderer outside the package barrel. The live region that actually
 * announces a toast lives on the `Toaster` container there, with
 * `role="alert"` added per destructive toast — so do not move or "fix" the
 * announcement semantics here.
 *
 * The attributes below are still correct for this component on its own terms: a
 * viewport is a container that holds transient notifications, so it is a live
 * region by design. It is kept, and kept exported, because it is part of the
 * published surface of this package; removing one export of this module would
 * be a breaking change to every sibling primitive left beside it, all of which
 * are equally unrendered today.
 */
const ToastViewport = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className={cn('fixed top-0 z-1000 flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
)
ToastViewport.displayName = 'ToastViewport'

export {
  Toast,
  ToastAction,
  ToastClose,
  ToastTitle,
  ToastDescription,
  ToastFooter,
  ToastHeader,
  ToastViewport,
}
