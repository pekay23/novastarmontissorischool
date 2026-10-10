'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirm,
  useToast,
} from '@novastar/shared-ui'
import { BookOpen, Plus } from 'lucide-react'
import {
  SyllabusFormDialog,
  emptySyllabusForm,
  type ClassSubjectOption,
  type SyllabusFormState,
  type TermOption,
} from './syllabus-form-dialog'
import { normaliseTopics } from './topic-list'

interface Syllabus {
  id: string
  classSubjectId: string
  termId: string
  title: string
  body: string | null
  topics: string[]
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  classSubject: ClassSubjectOption
  term: { id: string; name: string; academicYear: { name: string } }
  updatedAt: string
}

const STATUS_VARIANT: Record<Syllabus['status'], 'default' | 'secondary' | 'outline'> = {
  DRAFT: 'secondary',
  PUBLISHED: 'default',
  ARCHIVED: 'outline',
}

export default function SyllabusPage() {
  const { toast } = useToast()
  const confirm = useConfirm()

  const [syllabi, setSyllabi] = useState<Syllabus[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [terms, setTerms] = useState<TermOption[]>([])
  const [classSubjects, setClassSubjects] = useState<ClassSubjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Syllabus | null>(null)
  const [form, setForm] = useState<SyllabusFormState>(emptySyllabusForm([]))

  /**
   * List and option lists are two calls on the same read gate rather than
   * two effects racing each other: the form cannot be built without the
   * lookups, and a failure in either should leave the page in one settled
   * state rather than a spinner that never resolves.
   *
   * `search` is deliberately client-side. It filters an already-loaded,
   * tenant-scoped list, and the API has no search parameter — sending it
   * would be a no-op that looked like it worked.
   */
  const fetchSyllabi = useCallback(async () => {
    setLoading(true)
    try {
      const [listRes, lookupRes] = await Promise.all([
        fetch('/portal/api/syllabi'),
        fetch('/portal/api/syllabi?lookups=true'),
      ])

      if (listRes.ok) {
        const payload = await listRes.json()
        setSyllabi(payload.data ?? [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load syllabi' })
      }

      // A failed lookup only costs the create form its dropdowns, so it is
      // silent here and the New Syllabus button stays usable — it opens with
      // an empty term and the user picks everything by hand.
      if (lookupRes.ok) {
        const lookup = await lookupRes.json()
        setClasses(lookup.data?.classes ?? [])
        setTerms(lookup.data?.terms ?? [])
        setClassSubjects(lookup.data?.classSubjects ?? [])
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load syllabi' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    // Through an async function rather than calling the fetcher directly: the
    // fetcher's first statement is a `setLoading`, and a synchronous
    // `setState` in an effect body is a cascading render. This is the same
    // shape `attendance/[id]/page.tsx` uses.
    const load = async () => {
      await fetchSyllabi()
    }
    void load()
  }, [fetchSyllabi])

  const handleNew = () => {
    setEditing(null)
    setForm(emptySyllabusForm(terms))
    setDialogOpen(true)
  }

  const handleEdit = (syllabus: Syllabus) => {
    setEditing(syllabus)
    setForm({
      classSubjectId: syllabus.classSubjectId,
      termId: syllabus.termId,
      title: syllabus.title,
      body: syllabus.body ?? '',
      // The stored list is already normalised. `removeTopic` guarantees a
      // blank row exists, so the editor is never handed an empty list.
      topics: syllabus.topics.length > 0 ? [...syllabus.topics] : [''],
      status: syllabus.status,
    })
    setDialogOpen(true)
  }

  const handleDelete = async (syllabus: Syllabus) => {
    const ok = await confirm({
      title: 'Delete syllabus?',
      description: `Delete "${syllabus.title}" for ${syllabus.classSubject.subject.name} (${syllabus.classSubject.class.name})? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/portal/api/config/syllabus/${syllabus.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        toast.error({
          title: 'Error',
          description: payload?.error ?? 'Failed to delete syllabus',
        })
        return
      }
      toast.success({ title: 'Success', description: 'Syllabus deleted' })
      void fetchSyllabi()
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete syllabus' })
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    // Blank rows are an editing artefact, not content. They are dropped here
    // so the API receives the same list the user sees, and the API's own
    // `min(1)` is what reports an entirely empty syllabus.
    const topics = normaliseTopics(form.topics)
    if (topics.length === 0) {
      toast.error({ title: 'Error', description: 'Add at least one topic' })
      return
    }

    setSaving(true)
    try {
      const payload = {
        classSubjectId: form.classSubjectId,
        termId: form.termId,
        title: form.title.trim(),
        body: form.body.trim().length > 0 ? form.body.trim() : null,
        topics,
        status: form.status,
      }

      const res = await fetch(editing ? `/api/config/syllabus/${editing.id}` : '/api/syllabi', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        toast.success({
          title: 'Success',
          description: editing ? 'Syllabus updated' : 'Syllabus created',
        })
        setDialogOpen(false)
        setEditing(null)
        void fetchSyllabi()
        return
      }

      const error = await res.json().catch(() => null)
      toast.error({
        title: res.status === 409 ? 'Duplicate syllabus' : 'Error',
        description:
          error?.error ?? (res.status === 409 ? 'That title already exists' : 'Failed to save syllabus'),
      })
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save syllabus' })
    } finally {
      setSaving(false)
    }
  }

  const query = search.trim().toLowerCase()
  const visible = syllabi.filter(
    (syllabus) =>
      query.length === 0 ||
      syllabus.title.toLowerCase().includes(query) ||
      syllabus.classSubject.subject.name.toLowerCase().includes(query) ||
      syllabus.classSubject.class.name.toLowerCase().includes(query) ||
      syllabus.term.name.toLowerCase().includes(query),
  )

  if (loading && syllabi.length === 0) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Syllabus</h1>
          <p className="text-sm text-muted-foreground">
            Structured topic lists per class subject and term
          </p>
        </div>
        <Button className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" />
          New Syllabus
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            Syllabi ({visible.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="sr-only" htmlFor="syllabus-search">
            Search syllabi
          </label>
          <Input
            id="syllabus-search"
            value={search}
            placeholder="Search by title, subject, class or term"
            onChange={(event) => setSearch(event.target.value)}
          />

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {syllabi.length === 0
                ? 'No syllabi yet. Create the first one for a class subject and term.'
                : 'No syllabi match that search.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead>Topics</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((syllabus) => (
                  <TableRow key={syllabus.id}>
                    <TableCell className="font-medium">{syllabus.title}</TableCell>
                    <TableCell>{syllabus.classSubject.class.name}</TableCell>
                    <TableCell>{syllabus.classSubject.subject.name}</TableCell>
                    <TableCell>
                      {syllabus.term.name}
                      <span className="block text-xs text-muted-foreground">
                        {syllabus.term.academicYear.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ol className="list-inside list-decimal space-y-0.5 text-sm text-muted-foreground">
                        {syllabus.topics.map((topic, index) => (
                          <li key={index}>{topic}</li>
                        ))}
                      </ol>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[syllabus.status]}>{syllabus.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(syllabus)}>
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleDelete(syllabus)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SyllabusFormDialog
        open={dialogOpen}
        editing={editing}
        form={form}
        classes={classes}
        terms={terms}
        classSubjects={classSubjects}
        saving={saving}
        onFormChange={setForm}
        onSubmit={handleSubmit}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditing(null)
        }}
      />
    </div>
  )
}