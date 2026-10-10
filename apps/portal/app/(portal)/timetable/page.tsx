'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, useToast,
  TimetableGrid, type TimetablePeriod,
} from '@novastar/shared-ui'
import { CalendarDays, Search } from 'lucide-react'

interface TimetableApiEntry {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
  room: string | null
  classSubject: {
    subject: { name: string; code: string } | null
    teacher: { firstName: string; lastName: string } | null
  } | null
}

interface TimetableApiResponse {
  data: {
    id: string
    name: string
    isPublished: boolean
    classId: string
    termId: string
    /** Present since the route selects the names alongside the ids. */
    class: { id: string; name: string } | null
    term: { id: string; name: string } | null
    entries: TimetableApiEntry[]
  }
}

/** Project the API's nested rows into the grid's flat period list. */
function toPeriods(entries: TimetableApiEntry[]): TimetablePeriod[] {
  return entries.map((entry) => ({
    id: entry.id,
    dayOfWeek: entry.dayOfWeek,
    startTime: entry.startTime,
    endTime: entry.endTime,
    room: entry.room,
    subjectName: entry.classSubject?.subject?.name ?? 'Unknown subject',
    subjectCode: entry.classSubject?.subject?.code ?? null,
    teacherName: entry.classSubject?.teacher
      ? `${entry.classSubject.teacher.firstName} ${entry.classSubject.teacher.lastName}`
      : null,
  }))
}

export default function TimetablePage() {
  const searchParams = useSearchParams()
  const { toast } = useToast()

  // Class and term come from the URL so the view is linkable and
  // shareable: `/timetable?class=<id>&term=<id>`.
  const classId = searchParams.get('class')
  const termId = searchParams.get('term')

  const [timetable, setTimetable] = useState<TimetableApiResponse['data'] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchTimetable = useCallback(async (cid: string, tid: string) => {
    setNotFound(false)
    try {
      const params = new URLSearchParams()
      params.set('classId', cid)
      params.set('termId', tid)
      const res = await fetch(`/api/timetable?${params}`)
      if (res.ok) {
        const data: TimetableApiResponse = await res.json()
        setTimetable(data.data)
      } else if (res.status === 404) {
        setTimetable(null)
        setNotFound(true)
      } else {
        toast.error({ title: 'Error', description: 'Failed to load timetable' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load timetable' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setTimetable(null)
      setNotFound(false)
      if (classId && termId) {
        await fetchTimetable(classId, termId)
      } else {
        setLoading(false)
      }
    }
    load()
  }, [classId, termId, fetchTimetable])

  // No class/term selected: nothing to fetch yet. The grid is
  // reachable by link (`/timetable?class=<id>&term=<id>`), most
  // usefully from the teacher workspace's "View Timetable" action.
  if (!classId || !termId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-heading font-bold">Timetable</h1>
          <p className="text-sm text-muted-foreground">Weekly class schedules</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Search className="h-12 w-12 text-muted-foreground opacity-50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Open a timetable from a class or teacher workspace, or select a
              class and term.
            </p>
            <Button variant="outline" size="sm" asChild className="mt-4">
              <Link href="/teachers/me">Go to My Workspace</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-heading font-bold">Timetable</h1>
          <p className="text-sm text-muted-foreground">Weekly class schedules</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Timetable</h1>
          <p className="text-sm text-muted-foreground">Weekly class schedules</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Class Timetable
          </CardTitle>
          <CardDescription>
            Class: {timetable?.class?.name ?? classId} • Term:{' '}
            {timetable?.term?.name ?? termId}
            {timetable ? ` • ${timetable.name}` : ''}
            {timetable?.isPublished ? ' (published)' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notFound || !timetable ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No timetable found for this class and term.
            </p>
          ) : (
            <TimetableGrid
              periods={toPeriods(timetable.entries)}
              classLabel={timetable.class?.name ?? classId}
              termLabel={timetable.term?.name ?? termId}
              name={timetable.name}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
