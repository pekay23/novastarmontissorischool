'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, DayFlag, SelectionState, UI } from 'react-day-picker'
import { cn } from '../lib/utils'
import { buttonVariants } from './button'

/**
 * The calendar, styled for react-day-picker v10.
 *
 * v9 replaced the snake_case `classNames` keys with the `UI` enum and turned
 * the nav icons into the `Chevron` custom component, so the v8 spellings below
 * (`caption`, `nav_button`, `table`, `head_row`, `button`, …) no longer match
 * any element and silently styled nothing. The keys are the enum members now,
 * which is what keeps the overrides honest: a rename in a future version is a
 * type error here rather than a class that quietly stops applying.
 */
export function Calendar({
  className,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays
      className={cn('p-3', className)}
      classNames={{
        [UI.Months]: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        [UI.Month]: 'space-y-4',
        [UI.MonthCaption]: 'flex justify-center pt-1 pb-2',
        [UI.CaptionLabel]: 'text-sm font-medium',
        [UI.Nav]: 'relative flex items-center',
        [UI.PreviousMonthButton]: cn('absolute left-2', buttonVariants({ variant: 'ghost' })),
        [UI.NextMonthButton]: cn('absolute right-2', buttonVariants({ variant: 'ghost' })),
        [UI.MonthGrid]: 'w-full border-collapse',
        [UI.Weekdays]: 'flex',
        [UI.Weekday]: 'text-muted-foreground w-8 font-normal text-[0.8rem]',
        [UI.Week]: 'flex w-full',
        [UI.Day]: 'relative h-8 w-8 border border-transparent text-center text-sm',
        [UI.DayButton]: cn('h-8 w-8 p-0 font-normal', buttonVariants({ variant: 'ghost' })),
        [SelectionState.selected]:
          'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
        [DayFlag.disabled]: 'opacity-50',
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" {...chevronProps} />
          ) : (
            <ChevronRight className="h-4 w-4" {...chevronProps} />
          ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'
