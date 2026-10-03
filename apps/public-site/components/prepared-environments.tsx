'use client'

import { useId, useState } from 'react'

import { cn } from '@novastar/shared-ui'

export interface EnvironmentPanel {
  id: string
  tab: string
  plane: string
  heading: string
  body: string
  focus: { title: string; body: string }[]
  schedule: string
}

interface PreparedEnvironmentsProps {
  panels: EnvironmentPanel[]
}

/*
 * The prepared-environments switcher.
 *
 * A client component because it owns the selected index. The panel data is
 * passed from a server component, and the initially selected panel is
 * server-rendered, so the first panel is readable with JavaScript disabled.
 *
 * Only the selected panel is rendered. Five panels of Montessori prose is a lot
 * of duplicated text for a crawler or a screen reader to wade through, and none
 * of it is visible at the same time.
 */
export function PreparedEnvironments({ panels }: PreparedEnvironmentsProps) {
  const [active, setActive] = useState(0)
  const current = panels[active]

  /*
   * `useId` emits React's internal format, which contains colons. Those are
   * legal in an id attribute and in an IDREF, but they break any future
   * `querySelector` against these ids, so they are stripped once here rather
   * than at each call site.
   */
  const idPrefix = useId().replace(/[^a-zA-Z0-9]/g, '')

  /*
   * The prop type permits an empty array, and indexing past the end yields
   * undefined. Every caller passes a non-empty constant today, but an empty
   * `panels` would otherwise render a tablist with nothing in it and crash on
   * `current.focus`. The check has to sit after both hooks.
   */
  if (!current) return null

  /*
   * Roving tabindex plus arrow-key movement: Tab leaves the tablist in one stop
   * and the arrows move within it. This is the WAI-ARIA authoring-practice
   * pattern for a horizontal tablist, so Left/Right wrap and Home/End jump. Up
   * and Down are deliberately not handled — the tablist exposes its default
   * `aria-orientation="horizontal"`, and swallowing those keys would suppress
   * page scrolling for no benefit.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = panels.length - 1
    let next: number

    switch (event.key) {
      case 'ArrowRight':
        next = active === last ? 0 : active + 1
        break
      case 'ArrowLeft':
        next = active === 0 ? last : active - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      default:
        return
    }

    event.preventDefault()
    setActive(next)
    // Focus follows selection so the next keypress lands on the new tab.
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus()
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Prepared environments"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-surface p-1.5"
      >
        {panels.map((panel, i) => (
          <button
            key={panel.id}
            id={`${idPrefix}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={cn(
              'rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
              i === active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {panel.tab}
          </button>
        ))}
      </div>

      {/*
        `tabIndex={0}` because the panel holds no focusable elements of its own;
        without it a keyboard user cannot reach the text inside. The global
        `:focus-visible` outline is left in place — this is a real tab stop, and
        suppressing it would leave a focusable element with no visible indicator.
      */}
      <div
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${active}`}
        tabIndex={0}
        className="mt-8"
      >
        <article className="rounded-2xl border border-border bg-surface p-8 shadow-sm lg:p-10">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-label-md uppercase tracking-[0.06em] text-tertiary-container">
                {current.plane}
              </p>
              <h3 className="text-headline-md text-foreground">{current.heading}</h3>
              <p className="max-w-3xl leading-relaxed text-muted-foreground">{current.body}</p>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2">
              {current.focus.map((item) => (
                <li
                  key={item.title}
                  className="rounded-xl border border-border bg-surface-container-low p-4"
                >
                  <p className="font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ul>

            <p className="border-t border-border pt-4 text-label-sm uppercase tracking-[0.08em] text-muted-foreground">
              {current.schedule}
            </p>
          </div>
        </article>
      </div>
    </div>
  )
}