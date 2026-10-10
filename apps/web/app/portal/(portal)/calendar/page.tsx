'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  useToast,
  useConfirm,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@novastar/shared-ui'
import { ContentStatus } from '@novastar/database'
import { Plus, Search, MoreHorizontal, Edit2, Trash2, Save, X } from 'lucide-react'

interface CalendarEvent {
  id: string
  title: string
  descriptionEn: string
  descriptionTw: string | null
  startDate: string
  endDate: string
  location: string | null
  audience: string[]
  isAllDay: boolean
  recurrence: string | null
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

interface EventForm {
  title: string
  description: string
  startDate: string
  endDate: string
  location: string
  isAllDay: boolean
  status: ContentStatus
}

const STATUS_OPTIONS: { value: ContentStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
]

export default function CalendarPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [form, setForm] = useState<EventForm>({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    location: '',
    isAllDay: false,
    status: 'DRAFT',
  })

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/portal/api/events?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load events' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load events' })
    } finally {
      setLoading(false)
    }
  }, [search, toast])

  useEffect(() => {
    const load = async () => {
      await fetchEvents()
    }
    load()
  }, [fetchEvents])

  const handleSearch = (value: string) => {
    setSearch(value)
    if (value.length >= 2 || value.length === 0) {
      void fetchEvents()
    }
  }

  const handleNew = () => {
    setEditingEvent(null)
    setForm({
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      location: '',
      isAllDay: false,
      status: 'DRAFT',
    })
    setDialogOpen(true)
  }

  const handleEdit = (e: CalendarEvent) => {
    setEditingEvent(e)
    setForm({
      title: e.title,
      description: e.descriptionEn || '',
      startDate: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : '',
      endDate: e.endDate ? new Date(e.endDate).toISOString().split('T')[0] : '',
      location: e.location || '',
      isAllDay: e.isAllDay,
      status: e.status,
    })
    setDialogOpen(true)
  }

  const handleDelete = async (e: CalendarEvent) => {
    const ok = await confirm({
      title: 'Delete Event?',
      description: `This will permanently delete "${e.title}". This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/portal/api/events/${e.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Event deleted' })
        void fetchEvents()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete event' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete event' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const body: Record<string, unknown> = {
      title: form.title,
      descriptionEn: form.description,
      startDate: form.startDate,
      endDate: form.endDate,
      location: form.location || null,
      isAllDay: form.isAllDay,
      status: form.status,
      audience: ['ALL'],
    }

    try {
      let res: Response
      if (editingEvent) {
        res = await fetch(`/portal/api/events/${editingEvent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/portal/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      if (res.ok) {
        const data = await res.json()
        toast.success({
          title: 'Success',
          description: editingEvent
            ? 'Event updated successfully'
            : (data.message ?? 'Event created successfully'),
        })
        setDialogOpen(false)
        setEditingEvent(null)
        void fetchEvents()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to save event' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save event' })
    }
  }

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setEditingEvent(null)
    }
  }

  const today = new Date()
  const upcoming = events.filter(
    (e) => e.startDate && new Date(e.startDate) >= today,
  )
  const past = events.filter((e) => e.startDate && new Date(e.startDate) < today)

  const statusColors: Record<ContentStatus, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    PUBLISHED: 'bg-green-100 text-green-800',
    ARCHIVED: 'bg-blue-100 text-blue-800',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">School Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Manage school events and calendar activities
          </p>
        </div>
        <Button className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" />
          New Event
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search events..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming Events ({upcoming.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-muted-foreground">No upcoming events.</p>
          ) : (
            <ul className="space-y-3">
              {upcoming.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between border-l-2 border-primary pl-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{e.title}</p>
                      <Badge
                        variant="outline"
                        className={statusColors[e.status] ?? 'bg-muted text-muted-foreground'}
                      >
                        {e.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {e.startDate
                        ? new Date(e.startDate).toLocaleDateString()
                        : '-'}
                      {e.location && ` • ${e.location}`}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(e)}>
                        <Edit2 className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDelete(e)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Past Events ({past.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {past.length === 0 ? (
            <p className="text-muted-foreground">No past events.</p>
          ) : (
            <ul className="space-y-3">
              {past.map((e) => (
                <li key={e.id} className="border-l-2 border-muted pl-3">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{e.title}</p>
                    <Badge
                      variant="outline"
                      className={statusColors[e.status] ?? 'bg-muted text-muted-foreground'}
                    >
                      {e.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {e.startDate
                      ? new Date(e.startDate).toLocaleDateString()
                      : '-'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEvent ? 'Edit Event' : 'New Event'}</DialogTitle>
            <DialogDescription>
              {editingEvent
                ? 'Update event details below.'
                : 'Fill in the event details below.'}
            </DialogDescription>
          </DialogHeader>

          <form id="event-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date *</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date *</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g., Main Hall, Room 101"
              />
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isAllDay"
                checked={form.isAllDay}
                onChange={(e) => setForm({ ...form, isAllDay: e.target.checked })}
              />
              <Label htmlFor="isAllDay" className="font-normal">
                All-day event
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as ContentStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDialogClose(false)}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" form="event-form">
              <Save className="h-4 w-4 mr-2" />
              {editingEvent ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
