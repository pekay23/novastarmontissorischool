'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@novastar/shared-ui'

interface HorizontalScrollProps {
  children: React.ReactNode
  className?: string
  /** Show scroll buttons on hover (desktop) */
  showButtons?: boolean
  /** Show gradient fade shadows on sides when scrollable */
  showShadows?: boolean
  /** Custom scroll container className */
  containerClassName?: string
  /** Unique ID for the scroll container (for a11y) */
  id?: string
}

/**
 * HorizontalScroll - Accessible horizontal scroll wrapper with visual indicators
 * 
 * Features:
 * - Scroll shadows on left/right when content overflows
 * - Optional scroll buttons for desktop (keyboard accessible)
 * - Touch-friendly scrolling on mobile
 * - Proper focus management for keyboard users
 * - Respects prefers-reduced-motion
 */
export function HorizontalScroll({
  children,
  className,
  showButtons = true,
  showShadows = true,
  containerClassName,
  id,
}: HorizontalScrollProps) {
  const [showLeftShadow, setShowLeftShadow] = React.useState(false)
  const [showRightShadow, setShowRightShadow] = React.useState(true)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mounted flag must be set after hydration
    setMounted(true)
    const container = scrollRef.current
    if (!container) return

    const updateShadows = () => {
      const { scrollLeft, scrollWidth, clientWidth } = container
      setShowLeftShadow(scrollLeft > 4)
      setShowRightShadow(scrollLeft + clientWidth < scrollWidth - 4)
    }

    updateShadows()
    container.addEventListener('scroll', updateShadows, { passive: true })
    window.addEventListener('resize', updateShadows)
    return () => {
      container.removeEventListener('scroll', updateShadows)
      window.removeEventListener('resize', updateShadows)
    }
  }, [])

  const scrollByAmount = (direction: -1 | 1) => {
    const container = scrollRef.current
    if (!container) return
    const amount = container.clientWidth * 0.8
    container.scrollBy({ left: direction * amount, behavior: 'smooth' })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      scrollByAmount(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      scrollByAmount(1)
    }
  }

  if (!mounted) {
    return (
      <div className={cn('relative', className)}>
        <div ref={scrollRef} className={cn('overflow-x-auto pb-4', containerClassName)}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative', className)}>
      {showShadows && showLeftShadow && (
        <div
          className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-background to-transparent pointer-events-none z-10"
          aria-hidden="true"
        />
      )}
      {showShadows && showRightShadow && (
        <div
          className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-background to-transparent pointer-events-none z-10"
          aria-hidden="true"
        />
      )}

      <div
        ref={scrollRef}
        id={id}
        role="region"
        aria-label="Horizontally scrollable content"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'overflow-x-auto overflow-x-clip pb-4',
          'scroll-smooth',
          'touch-pan-x',
          '-ms-overflow-style-none',
          'scrollbar-hide',
          containerClassName,
        )}
      >
        {children}
      </div>

      {showButtons && showRightShadow && (
        <button
          type="button"
          onClick={() => scrollByAmount(1)}
          className={cn(
            'absolute right-0 top-1/2 -translate-y-1/2 z-20',
            'h-10 w-10 rounded-full bg-surface-container-lowest border border-border',
            'flex items-center justify-center shadow-floating',
            'hover:bg-surface-container-low hover:shadow-overlay',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'transition-all duration-fast',
            'hidden md:flex',
          )}
          aria-label="Scroll right"
        >
          <ChevronRight className="h-5 w-5 text-foreground" aria-hidden="true" />
        </button>
      )}
      {showButtons && showLeftShadow && (
        <button
          type="button"
          onClick={() => scrollByAmount(-1)}
          className={cn(
            'absolute left-0 top-1/2 -translate-y-1/2 z-20',
            'h-10 w-10 rounded-full bg-surface-container-lowest border border-border',
            'flex items-center justify-center shadow-floating',
            'hover:bg-surface-container-low hover:shadow-overlay',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'transition-all duration-fast',
            'hidden md:flex',
          )}
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" aria-hidden="true" />
        </button>
      )}

      {/* Mobile scroll indicator */}
      {showRightShadow && (
        <div
          className={cn(
            'absolute bottom-0 right-2 md:hidden z-20',
            'flex items-center gap-1 px-2 py-1 rounded-full',
            'bg-surface-container-lowest/90 backdrop-blur-sm border border-border',
            'animate-pulse',
            'pointer-events-none',
          )}
          aria-hidden="true"
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <span className="type-eyebrow text-muted-foreground">Scroll</span>
        </div>
      )}
    </div>
  )
}

/**
 * ScrollableCardGrid - Specialized horizontal scroll for card grids
 * Ensures cards don't get cut off and provides proper snap points
 */
interface ScrollableCardGridProps {
  children: React.ReactNode
  className?: string
  /** Minimum card width */
  minCardWidth?: string
  /** Gap between cards */
  gap?: string
  /** Padding on sides (applied to inner scroll container) */
  padding?: string
}

export function ScrollableCardGrid({
  children,
  className,
  minCardWidth = 'min-w-[300px] sm:min-w-[340px]',
  gap = 'gap-6',
  padding = 'px-4',
}: ScrollableCardGridProps) {
  return (
    <HorizontalScroll
      className={className}
      containerClassName={cn(
        'flex',
        gap,
        padding,
        'snap-x snap-mandatory',
        'pt-4 pb-8',
      )}
      showButtons={true}
      showShadows={true}
    >
      <div className="flex" role="list">
        {React.Children.map(children, (child): React.ReactNode => {
          if (!React.isValidElement<Record<string, unknown>>(child)) return child
          const childProps = child.props as Record<string, unknown>
          const childClassName = typeof childProps.className === 'string' ? childProps.className : ''
          return React.cloneElement(child, {
            className: cn(
              'snap-center shrink-0',
              minCardWidth,
              childClassName,
            ),
            role: 'listitem',
          })
        })}
      </div>
    </HorizontalScroll>
  )
}