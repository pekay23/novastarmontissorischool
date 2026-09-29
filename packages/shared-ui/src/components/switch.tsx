'use client'

import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '../lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors',
      className
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'absolute bottom-0.5 left-0.5 h-4 w-4 rounded-full bg-background shadow-md transition-transform'
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
