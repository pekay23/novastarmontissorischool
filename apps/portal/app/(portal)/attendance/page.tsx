'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, Button } from '@novastar/shared-ui'
import { Clock } from 'lucide-react'

interface ClassOption {
  id: string
  name: string
  studentCount: number
}

export default function AttendancePage() {
  const router = useRouter()
  const [classes, setClasses] = useState<ClassOption[]>([])
  const [loading, setLoading] = useState(true)

  const fetchClasses = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/classes')
      if (res.ok) {
        const data = await res.json()
        const mapped = (data.data || []).map((c: { id: string; name: string; _count?: { students?: number } }) => ({
          id: c.id,
          name: c.name,
          studentCount: c._count?.students || 0,
        }))
        setClasses(mapped)
      }
    } catch {
      // silently fail, page shows empty state
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      await fetchClasses()
    }
    load()
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Attendance</h1>
          <p className="text-sm text-muted-foreground">Mark and track student attendance by class</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Mark Attendance by Class
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Select a class to mark today's attendance. Any staff designated by the
            head of school can mark attendance.
          </p>

          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : classes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No classes found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {classes.map((cls) => (
                <Card key={cls.id} className="hover:bg-accent transition-colors">
                  <CardContent className="pt-4">
                    <CardTitle className="text-lg">{cls.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {cls.studentCount} students
                    </p>
                    <Button
                      className="mt-2 w-full"
                      size="sm"
                      onClick={() => {
                        const today = new Date().toISOString().split('T')[0]
                        router.push(`/attendance/mark?class=${cls.id}&date=${today}`)
                      }}
                    >
                      Mark Attendance
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
