import { format, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
import { metadata } from '@/lib/metadata'

export { metadata }

// Placeholder event data
const EVENTS = [
  {
    id: '1',
    title: 'Term 1 Exams',
    start: '2026-10-15',
    end: '2026-10-20',
    description: 'End of Term 1 examination period for all classes.',
    location: 'School Campus',
    category: 'Academic',
  },
  {
    id: '2',
    title: 'PTA General Meeting',
    start: '2026-11-05',
    end: '2026-11-05',
    description: 'Quarterly PTA meeting to discuss school development and parent concerns.',
    location: 'School Hall',
    category: 'Community',
  },
  {
    id: '3',
    title: 'Mid-Term Break',
    start: '2026-10-28',
    end: '2026-11-03',
    description: 'School will be closed for mid-term break.',
    location: 'All Day Event',
    category: 'Holiday',
  },
  {
    id: '4',
    title: 'Science Fair',
    start: '2026-12-10',
    end: '2026-12-10',
    description: 'Annual science fair showcasing student projects.',
    location: 'School Auditorium',
    category: 'Academic',
  },
]

export default function EventsPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Events Calendar</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Stay updated with upcoming events and important dates at Novastar Montessori School.
          </p>
        </div>
      </section>

      {/* Events Grid */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto space-y-6">
            {EVENTS.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function EventCard({ event }: { event: typeof EVENTS[0] }) {
  const startDate = parseISO(event.start)
  const endDate = parseISO(event.end)
  const isSameDay = event.start === event.end

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <CardTitle className="text-xl text-primary">{event.title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {isSameDay
                ? format(startDate, 'EEEE, MMMM d, yyyy')
                : `${format(startDate, 'MMM d')} – ${format(endDate, 'MMM d, yyyy')}`}
            </p>
          </div>
          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
            {event.category}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-foreground/80 mb-3">{event.description}</p>
        <p className="text-sm text-muted-foreground">📍 {event.location}</p>
      </CardContent>
    </Card>
  )
}