import { cn } from '@novastar/shared-ui'
import { format } from 'date-fns'
import { MapPin } from 'lucide-react'
import type { Event } from '@prisma/client'

import { CARD_PAD, Card, CardTitle, HeroBand, SectionShell } from '@/components/marketing'
import { getPublishedEvents } from '@/lib/data'
import { generateEventsMetadata } from '@/lib/metadata'

export const metadata = generateEventsMetadata()

/*
 * Content comes from the database. This page previously rendered four
 * hardcoded events with precise dates — "Term 1 Exams" 15–20 October 2026, a PTA
 * meeting, a mid-term break, a science fair — which read as confirmed school
 * dates but were invented placeholders. Parents plan childcare around those.
 *
 * `getPublishedEvents` returns `[]` without a database, so the empty state
 * below ships until real events are published.
 */
export default async function EventsPage() {
  const events = await getPublishedEvents()

  return (
    <div className="min-h-screen">
      {/* Hero. The band wash is `--color-tint-warm` rather than the maroon-tinted
          `from-primary/10` every inner page carried before; `HeroBand` also owns
          the header clearance, which was re-stated per page. */}
      <HeroBand>
        <h1 className="font-serif text-5xl md:text-6xl mx-auto max-w-[18ch] text-center text-primary">Events Calendar</h1>
        <p className="mx-auto mt-6 max-w-[60ch] text-lg leading-relaxed text-foreground/85 text-center">
          Stay updated with upcoming events and important dates at Novastar Montessori School.
        </p>
      </HeroBand>

      <SectionShell tone="canvas">
        {events.length === 0 ? (
          <Card tone="flat" className={cn(CARD_PAD, 'mx-auto max-w-2xl text-center bg-surface-container-low border-transparent')}>
            <h2 className="font-serif text-3xl text-primary">No events scheduled yet</h2>
            <p className="mt-4 text-lg text-foreground/85">
              Term dates and events are published here once confirmed. Call the school
              office if you need dates before then.
            </p>
          </Card>
        ) : (
          /*
            The measure is on an inner element, not on `container`. `.container`
            is a later same-specificity declaration than any `max-w-*` utility,
            so the two on one element silently renders at the 80rem cap. See the
            `.container` note in `app/globals.css`.
          */
          <div className="mx-auto max-w-4xl space-y-6">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </SectionShell>
    </div>
  )
}

function EventCard({ event }: { event: Event }) {
  const start = new Date(event.startDate)
  const end = new Date(event.endDate)
  const isSameDay = start.toDateString() === end.toDateString()

  return (
    <Card tone="flat" className={cn(CARD_PAD, 'flex flex-col gap-4 bg-surface-container-low border-transparent transition-all duration-700 hover:-translate-y-1 hover:shadow-floating')}>
      <CardTitle className="font-serif text-xl text-primary">{event.title}</CardTitle>
      <p className="text-sm text-foreground/70">
        {/* <time> so the machine-readable value matches what is displayed. */}
        <time dateTime={event.startDate.toISOString()}>
          {isSameDay
            ? format(start, 'EEEE, MMMM d, yyyy')
            : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`}
        </time>
      </p>
      <p className="text-lg leading-relaxed text-foreground/85">
        {event.descriptionEn}
      </p>
      {event.location && (
        <p className="flex items-center gap-2 text-sm text-foreground/70">
          <MapPin className="h-4 w-4 shrink-0 text-primary/40" aria-hidden="true" />
          {event.location}
        </p>
      )}
    </Card>
  )
}