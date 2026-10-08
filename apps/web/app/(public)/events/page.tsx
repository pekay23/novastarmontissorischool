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
        <h1 className="type-display max-w-[18ch]">Events Calendar</h1>
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
          Stay updated with upcoming events and important dates at Novastar Montessori School.
        </p>
      </HeroBand>

      <SectionShell tone="canvas">
        {events.length === 0 ? (
          <Card className={cn(CARD_PAD, 'mx-auto max-w-2xl text-center')}>
            <h2 className="type-title text-primary">No events scheduled yet</h2>
            <p className="mt-2.5 text-muted-foreground">
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
    <Card className={cn(CARD_PAD, 'flex flex-col gap-3')}>
      <CardTitle className="text-primary">{event.title}</CardTitle>
      <p className="text-sm text-muted-foreground">
        {/* <time> so the machine-readable value matches what is displayed. */}
        <time dateTime={event.startDate.toISOString()}>
          {isSameDay
            ? format(start, 'EEEE, MMMM d, yyyy')
            : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`}
        </time>
      </p>
      <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
        {event.descriptionEn}
      </p>
      {event.location && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          {event.location}
        </p>
      )}
    </Card>
  )
}