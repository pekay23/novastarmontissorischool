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

const ToastViewport = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      // The live region. Without it a toast appears silently for anyone who
      // cannot see it, which is most of the failure feedback on this app.
      role="status"
      aria-live="polite"
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
