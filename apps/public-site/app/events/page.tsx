import { format } from 'date-fns'
import { MapPin } from 'lucide-react'
import type { Event } from '@prisma/client'
import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
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
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Events Calendar</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Stay updated with upcoming events and important dates at Novastar Montessori School.
          </p>
        </div>
      </section>

      <section className="section-y">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {events.length === 0 ? (
            <div className="mx-auto max-w-2xl rounded-xl border border-border bg-surface p-10 text-center">
              <h2 className="mb-2 font-heading text-xl font-semibold text-primary">
                No events scheduled yet
              </h2>
              <p className="text-muted-foreground">
                Term dates and events are published here once confirmed. Call the school
                office if you need dates before then.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-6">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function EventCard({ event }: { event: Event }) {
  const start = new Date(event.startDate)
  const end = new Date(event.endDate)
  const isSameDay = start.toDateString() === end.toDateString()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl text-primary">{event.title}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {/* <time> so the machine-readable value matches what is displayed. */}
          <time dateTime={event.startDate.toISOString()}>
            {isSameDay
              ? format(start, 'EEEE, MMMM d, yyyy')
              : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`}
          </time>
        </p>
      </CardHeader>
      <CardContent>
        <p className="text-foreground/80">{event.descriptionEn}</p>
        {event.location && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            {event.location}
          </p>
        )}
      </CardContent>
    </Card>
  )
}