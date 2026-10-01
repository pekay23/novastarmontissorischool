'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
import { Plus, Bell, MoreHorizontal, Edit2, Trash2, Save, X } from 'lucide-react'

interface Announcement {
  id: string
  title: string
  bodyEn: string
  bodyTw: string | null
  excerptEn: string | null
  excerptTw: string | null
  category: string | null
  featuredImage: string | null
  audience: string[]
  status: ContentStatus
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  author: { name: string } | null
}

interface AnnouncementForm {
  title: string
  bodyEn: string
  bodyTw: string
  excerptEn: string
  excerptTw: string
  targetAudience: string
  status: ContentStatus
  publishedAt: string
}

const STATUS_OPTIONS: { value: ContentStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
]

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default function AnnouncementsPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null)
  const [form, setForm] = useState<AnnouncementForm>({
    title: '',
    bodyEn: '',
    bodyTw: '',
    excerptEn: '',
    excerptTw: '',
    targetAudience: 'ALL',
    status: 'DRAFT',
    publishedAt: '',
  })

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/announcements')
      if (res.ok) {
        const data = await res.json()
        setAnnouncements(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load announcements' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load announcements' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const load = async () => {
      await fetchAnnouncements()
    }
    load()
  }, [fetchAnnouncements])

  const handleNew = () => {
    setEditingAnnouncement(null)
    setForm({
      title: '',
      bodyEn: '',
      bodyTw: '',
      excerptEn: '',
      excerptTw: '',
      targetAudience: 'ALL',
      status: 'DRAFT',
      publishedAt: new Date().toISOString().split('T')[0],
    })
    setDialogOpen(true)
  }

  const handleEdit = (a: Announcement) => {
    setEditingAnnouncement(a)
    setForm({
      title: a.title,
      bodyEn: a.bodyEn || '',
      bodyTw: a.bodyTw || '',
      excerptEn: a.excerptEn || '',
      excerptTw: a.excerptTw || '',
      targetAudience: a.audience?.[0] || 'ALL',
      status: a.status,
      publishedAt: a.publishedAt
        ? new Date(a.publishedAt).toISOString().split('T')[0]
        : '',
    })
    setDialogOpen(true)
  }

  const handleDelete = async (a: Announcement) => {
    const ok = await confirm({
      title: 'Delete Announcement?',
      description: `This will permanently delete "${a.title}". This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/announcements/${a.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Announcement deleted' })
        void fetchAnnouncements()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete announcement' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete announcement' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const slug = slugify(form.title)
    const body: Record<string, unknown> = {
      title: form.title,
      slug,
      bodyEn: form.bodyEn,
      bodyTw: form.bodyTw || undefined,
      excerptEn: form.excerptEn || undefined,
      excerptTw: form.excerptTw || undefined,
      audience: [form.targetAudience],
      status: form.status,
      publishedAt:
        form.status === 'PUBLISHED' && form.publishedAt
          ? form.publishedAt
          : undefined,
    }

    try {
      let res: Response
      if (editingAnnouncement) {
        res = await fetch(`/api/announcements/${editingAnnouncement.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/api/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      if (res.ok) {
        toast.success({
          title: 'Success',
          description: editingAnnouncement
            ? 'Announcement updated successfully'
            : 'Announcement created successfully',
        })
        setDialogOpen(false)
        setEditingAnnouncement(null)
        void fetchAnnouncements()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to save announcement' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save announcement' })
    }
  }

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      setEditingAnnouncement(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Announcements</h1>
          <p className="text-sm text-muted-foreground">Manage school announcements</p>
        </div>
        <Button className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" />
          New Announcement
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Announcements ({announcements.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No announcements yet.</p>
              <p className="text-sm mt-1">Click "New Announcement" to create one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {announcements.map((a) => (
                <Card key={a.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{a.title}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={a.status === 'PUBLISHED' ? 'default' : 'outline'}>
                          {a.status}
                        </Badge>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(a)}>
                              <Edit2 className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(a)}
                               className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <CardDescription>
                      {a.publishedAt
                        ? new Date(a.publishedAt).toLocaleDateString()
                        : new Date(a.createdAt).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {a.excerptEn || a.bodyEn || a.bodyTw || ''}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}
            </DialogTitle>
            <DialogDescription>
              {editingAnnouncement
                ? 'Update announcement details below.'
                : 'Fill in the announcement details below.'}
            </DialogDescription>
          </DialogHeader>

          <form id="announcement-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bodyEn">Body (English) *</Label>
                <Textarea
                  id="bodyEn"
                  rows={5}
                  value={form.bodyEn}
                  onChange={(e) => setForm({ ...form, bodyEn: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bodyTw">Body (Twi)</Label>
                <Textarea
                  id="bodyTw"
                  rows={5}
                  value={form.bodyTw}
                  onChange={(e) => setForm({ ...form, bodyTw: e.target.value })}
                  placeholder="Twi translation of the announcement body"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="excerptEn">Excerpt (English)</Label>
                <Textarea
                  id="excerptEn"
                  rows={2}
                  value={form.excerptEn}
                  onChange={(e) => setForm({ ...form, excerptEn: e.target.value })}
                  placeholder="Short summary in English (optional)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="excerptTw">Excerpt (Twi)</Label>
                <Textarea
                  id="excerptTw"
                  rows={2}
                  value={form.excerptTw}
                  onChange={(e) => setForm({ ...form, excerptTw: e.target.value })}
                  placeholder="Short summary in Twi (optional)"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="targetAudience">Target Audience</Label>
                <Input
                  id="targetAudience"
                  value={form.targetAudience}
                  onChange={(e) => setForm({ ...form, targetAudience: e.target.value })}
                  placeholder="e.g., ALL, PARENTS, STUDENTS"
                />
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
              <div className="space-y-2">
                <Label htmlFor="publishedAt">Published Date</Label>
                <Input
                  id="publishedAt"
                  type="date"
                  value={form.publishedAt}
                  onChange={(e) => setForm({ ...form, publishedAt: e.target.value })}
                />
              </div>
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
            <Button type="submit" form="announcement-form">
              <Save className="h-4 w-4 mr-2" />
              {editingAnnouncement ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
