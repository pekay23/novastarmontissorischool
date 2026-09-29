import * as React from 'react'
import { cn } from '../lib/utils'

const Skeleton = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative overflow-hidden rounded-md bg-muted',
      className
    )}
    {...props}
  >
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-background/20 to-transparent" />
  </div>
))
Skeleton.displayName = 'Skeleton'

export { Skeleton }
