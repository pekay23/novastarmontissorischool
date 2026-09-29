'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils'
import { buttonVariants } from './button'
import { DayPicker } from 'react-day-picker'

export function Calendar({
  className,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        caption: 'flex justify-center pt-1 pb-2',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        nav_button: cn(
          buttonVariants({ variant: 'ghost' })
        ),
        nav_button_previous: 'absolute left-2',
        nav_button_next: 'absolute right-2',
        table: 'w-full border-collapse',
        head_row: 'flex',
        head_cell: 'text-muted-foreground w-8 font-normal text-[0.8rem]',
        row: 'flex w-full',
        cell: 'h-8 w-8 border border-transparent text-center text-sm',
        button: cn(
          'h-8 w-8 p-0 font-normal',
          buttonVariants({ variant: 'ghost' })
        ),
        button_selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        button_disabled: 'opacity-50',
      } as any} // eslint-disable-line @typescript-eslint/no-explicit-any
      components={{
        PreviousMonthButton: ({ ...props }) => (
          <ChevronLeft className="h-4 w-4" {...props} />
        ),
        NextMonthButton: ({ ...props }) => (
          <ChevronRight className="h-4 w-4" {...props} />
        ),
      } as any} // eslint-disable-line @typescript-eslint/no-explicit-any
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'
