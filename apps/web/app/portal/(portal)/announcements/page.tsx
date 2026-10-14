'use client'
export const dynamic = 'force-dynamic'

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
  Popover,
  PopoverContent,
  PopoverTrigger,
  Checkbox,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@novastar/shared-ui'
import { useSession } from 'next-auth/react'
import { AnnouncementStatus } from '@prisma/client'
import { permissionsForRole, type PlatformRoleName } from '@novastar/shared-types'
import { PLATFORM_ROLES } from '@/lib/constants/platform-roles'
import { Plus, Bell, MoreHorizontal, Edit2, Trash2, Save, X } from 'lucide-react'

/**
 * Internal staff notices, from `Announcement`. Not `News`: the marketing CMS is
 * rendered by the public site and a row in it is one `status` flip from the
 * school's homepage. `Announcement` is stored separately and nothing public
 * reads it. See `app/api/announcements/route.ts`.
 *
 * `body` is single and plain because the record is single and plain — the old
 * `bodyEn`/`bodyTw`/`excerptEn`/`excerptTw`/`slug`/`featuredImage` set belonged to
 * the `News` article shape and had nowhere to be stored here.
 */
interface Announcement {
  id: string
  title: string
  body: string
  audience: string[]
  status: AnnouncementStatus
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  author: { name: string } | null
}

interface AnnouncementForm {
  title: string
  body: string
  targetAudience: string[]
  status: AnnouncementStatus
  publishedAt: string
}

const STATUS_OPTIONS: { value: AnnouncementStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
]

/**
 * What this caller may do on this page, from the same grant table the seed
 * applies and the routes check.
 *
 * The page was previously ungated: it rendered New Announcement, Edit and Delete
 * for every role that could open it, and the routes refused all three writes for
 * two of them. `ADMIN_STAFF` reaches `/announcements` and holds only
 * `announcement:read`; `PARENT` reaches it and holds only `announcement:read`
 * too (`ROLE_GRANT_RULES`, with `PORTAL_SECTIONS_BY_ROLE` granting both the
 * section). Both were shown a full management UI whose every button 403'd.
 *
 * This is a courtesy gate, not the authorisation: the routes still refuse, and
 * they are the thing that decides. Its purpose is that a parent opening the
 * notices meant for them sees notices, not a Create button that cannot work.
 */
export function announcementAbilities(role: string | null | undefined): {
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
} {
  const granted = role ? permissionsForRole(role as PlatformRoleName) : []
  return {
    canCreate: granted.includes('announcement:create'),
    canEdit: granted.includes('announcement:edit'),
    canDelete: granted.includes('announcement:delete'),
  }
}

export default function AnnouncementsPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const { data: session } = useSession()
  const abilities = announcementAbilities((session?.user as { role?: string } | undefined)?.role)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null)
  const [form, setForm] = useState<AnnouncementForm>({
    title: '',
    body: '',
    targetAudience: [],
    status: 'DRAFT',
    publishedAt: '',
  })

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/portal/api/announcements')
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
      body: '',
      targetAudience: [],
      status: 'DRAFT',
      publishedAt: new Date().toISOString().split('T')[0],
    })
    setDialogOpen(true)
  }

  const handleEdit = (a: Announcement) => {
    setEditingAnnouncement(a)
    setForm({
      title: a.title,
      body: a.body || '',
      targetAudience: a.audience ?? [],
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
      const res = await fetch(`/portal/api/announcements/${a.id}`, { method: 'DELETE' })
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

    const targetAudience = form.targetAudience
    const body: Record<string, unknown> = {
      title: form.title,
      body: form.body,
      // Empty audience means every role in the school, so a blank field is `[]`
      // rather than `['']`, which would name a role that does not exist and
      // target nobody while reading as addressed to someone.
      audience: targetAudience.length > 0 ? targetAudience : [],
      status: form.status,
      // Sent whenever a date is present, not only when publishing: on an edit the
      // route only fills in a default `publishedAt` when the field is ABSENT, so
      // withholding it would make an explicit date change a silent no-op.
      //
      // The two schemas differ, which is why this is not one expression for both.
      // `CreateAnnouncementSchema` takes `publishedAt: z.string().optional()`, so
      // `null` is rejected by a create; `UpdateAnnouncementSchema` takes
      // `.nullable().optional()`, so `null` is how "never published" is said on
      // an edit. Sending `null` to POST would 400 every unpublished draft.
      ...(form.publishedAt
        ? { publishedAt: form.publishedAt }
        : editingAnnouncement
          ? { publishedAt: null }
          : {}),
    }

    try {
      let res: Response
      if (editingAnnouncement) {
        res = await fetch(`/portal/api/announcements/${editingAnnouncement.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/portal/api/announcements', {
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
      setForm({
        title: '',
        body: '',
        targetAudience: [],
        status: 'DRAFT',
        publishedAt: '',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Announcements</h1>
          <p className="text-sm text-muted-foreground">Manage school announcements</p>
        </div>
        {/* Wrapped rather than disabled: a `disabled` New button reads as
              "broken", while hiding it and saying why reads as "not yours". */}
          {abilities.canCreate && (
            <Button className="gap-2" onClick={handleNew}>
              <Plus className="h-4 w-4" />
              New Announcement
            </Button>
          )}
        </div>

      {!abilities.canCreate && (
        // Stated rather than silently absent: a parent who sees no Create button
        // cannot tell whether this school has notices or whether they may not
        // write them. One sentence answers that.
        <p className="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
          You can read these notices. Writing them needs the {`announcement:create`} permission,
          which your role does not hold.
        </p>
      )}

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
                            {abilities.canEdit && (
                              <DropdownMenuItem onClick={() => handleEdit(a)}>
                                <Edit2 className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            {abilities.canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDelete(a)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            )}
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
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {a.body || ''}
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

            <div className="space-y-2">
              <Label htmlFor="body">Body *</Label>
              <Textarea
                id="body"
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="targetAudience">Target Audience</Label>
                <div className="border rounded-md p-2 min-h-[42px] flex flex-wrap gap-1 items-center">
                  {form.targetAudience.map((role) => (
                    <Badge key={role} variant="secondary" className="text-xs">
                      {role}
                      <button
                        type="button"
                        aria-label={`Remove ${role}`}
                        onClick={() => {
                          setForm({
                            ...form,
                            targetAudience: form.targetAudience.filter((r) => r !== role),
                          })
                        }}
                        className="ml-1"
                      >
                        ×
                      </button>
                    </Badge>
                  ))}
                  <div className="text-muted-foreground text-sm">
                    {form.targetAudience.length === 0 ? 'Select roles...' : ''}
                  </div>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="w-full">
                      Select Roles
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-2" align="start">
                    <div className="space-y-1">
                      {Object.values(PLATFORM_ROLES).map((role) => (
                        <label
                          key={role}
                          className="flex items-center justify-between rounded-sm px-2 py-1.5 cursor-pointer hover:bg-accent"
                        >
                          <span className="text-sm">{role}</span>
                          <Checkbox
                            checked={form.targetAudience.includes(role)}
                            onCheckedChange={(checked) => {
                              const current = form.targetAudience
                              const updated = checked
                                ? [...current, role]
                                : current.filter((r) => r !== role)
                              setForm({ ...form, targetAudience: updated })
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as AnnouncementStatus })}
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


