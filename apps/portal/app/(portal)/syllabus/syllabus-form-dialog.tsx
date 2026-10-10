'use client'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@novastar/shared-ui'
import { TopicEditor } from './topic-editor'
import { normaliseTopics } from './topic-list'

export interface ClassSubjectOption {
  id: string
  class: { id: string; name: string }
  subject: { id: string; name: string; code: string }
}

export interface TermOption {
  id: string
  name: string
  isCurrent: boolean
  academicYear: { name: string }
}

export interface SyllabusFormState {
  classSubjectId: string
  termId: string
  title: string
  body: string
  topics: readonly string[]
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
}

/**
 * The default form state for a new syllabus.
 *
 * The term defaults to the current term, falling back to the most recent
 * one the lookups returned, so the common case — authoring this term's
 * syllabus — needs no term selection at all. `topic-list`'s `removeTopic`
 * guarantees an empty topic list collapses to one blank row, so the form
 * always has somewhere to type.
 */
export function emptySyllabusForm(terms: readonly TermOption[]): SyllabusFormState {
  return {
    classSubjectId: '',
    termId: terms.find((term) => term.isCurrent)?.id ?? terms[0]?.id ?? '',
    title: '',
    body: '',
    topics: [''],
    status: 'DRAFT',
  }
}

/**
 * Why the form cannot be submitted, or `null` when it can.
 *
 * Extracted so the page can disable the submit button on the same rule the
 * submit handler enforces, rather than letting the user press submit and be
 * told they are wrong. `title` is checked with a trim because the API
 * rejects a whitespace-only title, and a button that is live for a title of
 * `'   '` is a button that only ever produces a 400.
 *
 * An edited syllabus already passed validation once and has had its topics
 * trimmed; it can legitimately be re-saved while the user is mid-edit, so
 * an empty `topics` list is only a blocker when there is at least one row to
 * judge. With no rows at all the API's own `min(1)` reports the real
 * problem.
 */
export function syllabusFormProblem(form: SyllabusFormState): string | null {
  if (form.title.trim().length === 0) return 'Title is required'
  if (!form.classSubjectId) return 'Select a class subject'
  if (!form.termId) return 'Select a term'
  if (normaliseTopics(form.topics).length === 0 && form.topics.length > 0) {
    return 'Add at least one topic'
  }
  return null
}

/**
 * The create/edit dialog.
 *
 * Edit goes through `PATCH /api/config/syllabus/[id]` and create through
 * `POST /api/syllabi`; both accept the same payload. The dedicated route is
 * the stricter of the two — it refuses an empty `topics` array and rejects a
 * duplicate title with a 409 — so a create that trips either reports the
 * server's own message rather than a generic failure.
 */
export function SyllabusFormDialog({
  open,
  editing,
  form,
  classes,
  terms,
  classSubjects,
  saving,
  onFormChange,
  onSubmit,
  onOpenChange,
}: {
  open: boolean
  /** The syllabus being edited, or `null` when creating. */
  editing: { id: string; title: string } | null
  form: SyllabusFormState
  classes: readonly { id: string; name: string }[]
  terms: readonly TermOption[]
  classSubjects: readonly ClassSubjectOption[]
  saving: boolean
  onFormChange: (next: SyllabusFormState) => void
  onSubmit: (event: React.FormEvent) => void
  onOpenChange: (open: boolean) => void
}) {
  const problem = syllabusFormProblem(form)
  const classNameById = new Map(classes.map((entry) => [entry.id, entry.name]))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Syllabus' : 'New Syllabus'}</DialogTitle>
          <DialogDescription>
            A structured topic list for one class subject in one term.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="syllabus-class-subject">Class subject</Label>
            <Select
              value={form.classSubjectId}
              disabled={saving}
              onValueChange={(value) => onFormChange({ ...form, classSubjectId: value })}
            >
              <SelectTrigger id="syllabus-class-subject">
                <SelectValue placeholder="Select a class subject" />
              </SelectTrigger>
              <SelectContent>
                {classSubjects.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {classNameById.get(option.class.id) ?? option.class.name} —{' '}
                    {option.subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="syllabus-term">Term</Label>
              <Select
                value={form.termId}
                disabled={saving}
                onValueChange={(value) => onFormChange({ ...form, termId: value })}
              >
                <SelectTrigger id="syllabus-term">
                  <SelectValue placeholder="Select a term" />
                </SelectTrigger>
                <SelectContent>
                  {terms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {term.name} · {term.academicYear.name}
                      {term.isCurrent ? ' (current)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="syllabus-status">Status</Label>
              <Select
                value={form.status}
                disabled={saving}
                onValueChange={(value) =>
                  onFormChange({ ...form, status: value as SyllabusFormState['status'] })
                }
              >
                <SelectTrigger id="syllabus-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PUBLISHED">Published</SelectItem>
                  <SelectItem value="ARCHIVED">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="syllabus-title">Title</Label>
            <Input
              id="syllabus-title"
              value={form.title}
              disabled={saving}
              placeholder="e.g. Term 1 — Number Bonds to 10"
              onChange={(event) => onFormChange({ ...form, title: event.target.value })}
            />
          </div>

          <TopicEditor
            topics={form.topics}
            disabled={saving}
            onChange={(topics) => onFormChange({ ...form, topics })}
          />

          <div className="space-y-2">
            <Label htmlFor="syllabus-body">Notes (optional)</Label>
            <Textarea
              id="syllabus-body"
              value={form.body}
              disabled={saving}
              rows={4}
              placeholder="Optional free-text notes for teachers. Topics above are the structured list."
              onChange={(event) => onFormChange({ ...form, body: event.target.value })}
            />
          </div>

          {problem && (
            <p role="note" className="text-sm text-muted-foreground">
              {problem}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || problem !== null}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create syllabus'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}