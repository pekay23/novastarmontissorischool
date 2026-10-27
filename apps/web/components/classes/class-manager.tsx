'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  useConfirm,
} from '@novastar/shared-ui'

interface SchoolClass {
  id: string
  name: string
  levelId: string
  stream: string | null
  capacity: number
  classTeacherId: string | null
  level: { name: string }
  classTeacher: { firstName: string; lastName: string } | null
  _count: { students: number }
}

interface ClassOptions {
  levels: { id: string; name: string }[]
  teachers: { id: string; firstName: string; lastName: string }[]
  canAssignTeacher: boolean
}

const emptyForm = {
  name: '',
  levelId: '',
  stream: '',
  capacity: '30',
  classTeacherId: '',
}

export function ClassManager({
  canCreate,
  canEdit,
  canDelete,
}: {
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}) {
  const confirm = useConfirm()
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [options, setOptions] = useState<ClassOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [editing, setEditing] = useState<SchoolClass | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/portal/api/classes')
      if (!response.ok)
        throw new Error('Unable to load classes. Please try again.')
      const payload = await response.json()
      setClasses(payload.data ?? [])
    } catch {
      setError('Unable to load classes. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadOptions = useCallback(async () => {
    try {
      const response = await fetch('/portal/api/classes/options')
      if (!response.ok) throw new Error('Unable to load class options')
      setOptions(await response.json())
      setFormError(null)
    } catch {
      setFormError('Unable to load class levels. Retry before saving a class.')
    }
  }, [])

  useEffect(() => {
    async function run() {
      await load()
    }
    void run()
  }, [load])
  useEffect(() => {
    async function run() {
      if (canCreate || canEdit) await loadOptions()
    }
    void run()
  }, [canCreate, canEdit, loadOptions])

  function openForm(record: SchoolClass | null) {
    setEditing(record)
    setForm(
      record
        ? {
            name: record.name,
            levelId: record.levelId,
            stream: record.stream ?? '',
            capacity: String(record.capacity),
            classTeacherId: record.classTeacherId ?? '',
          }
        : emptyForm,
    )
    setFormError(null)
    setFormOpen(true)
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!options) {
      setFormError('Load class options before saving.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const response = await fetch(
        editing
          ? `/portal/api/classes/${encodeURIComponent(editing.id)}`
          : '/portal/api/classes',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            levelId: form.levelId,
            stream: form.stream.trim() || (editing ? null : undefined),
            capacity: Number(form.capacity),
            ...(options.canAssignTeacher
              ? {
                  classTeacherId:
                    form.classTeacherId || (editing ? null : undefined),
                }
              : {}),
          }),
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setFormError(payload?.error ?? 'The class could not be saved.')
        return
      }
      setFormOpen(false)
      await load()
    } catch {
      setFormError('Could not reach the server. Your entries have been kept.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(record: SchoolClass) {
    if (
      !(await confirm({
        title: 'Delete class?',
        description: `Delete ${record.name}? Classes with linked records may need to be reassigned first.`,
        confirmText: 'Delete',
        variant: 'destructive',
      }))
    )
      return
    try {
      const response = await fetch(
        `/portal/api/classes/${encodeURIComponent(record.id)}`,
        { method: 'DELETE' },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setError(payload?.error ?? 'The class could not be deleted.')
        return
      }
      await load()
    } catch {
      setError('Could not reach the server. The class has not been deleted.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Classes</h1>
          <p className="text-sm text-muted-foreground">
            Manage class levels, capacity and teacher assignments.
          </p>
        </div>
        {canCreate && <Button onClick={() => openForm(null)}>Add class</Button>}
      </div>
      {error && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{error}</p>
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        </div>
      )}
      {formOpen && (
        <Card>
          <CardContent className="pt-6">
            <form
              onSubmit={save}
              className="space-y-4"
              aria-label={editing ? 'Edit class' : 'Add class'}
            >
              <h2 className="text-lg font-semibold">
                {editing ? 'Edit class' : 'Add class'}
              </h2>
              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              {!options && (
                <Button type="button" variant="outline" onClick={loadOptions}>
                  Retry loading class options
                </Button>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="class-name">Class name</Label>
                  <Input
                    id="class-name"
                    required
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="class-level">Class level</Label>
                  <select
                    id="class-level"
                    required
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={form.levelId}
                    onChange={(event) =>
                      setForm({ ...form, levelId: event.target.value })
                    }
                  >
                    <option value="">Select a level</option>
                    {options?.levels.map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="class-stream">Stream, optional</Label>
                  <Input
                    id="class-stream"
                    value={form.stream}
                    onChange={(event) =>
                      setForm({ ...form, stream: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="class-capacity">Capacity</Label>
                  <Input
                    id="class-capacity"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={form.capacity}
                    onChange={(event) =>
                      setForm({ ...form, capacity: event.target.value })
                    }
                  />
                </div>
                {options?.canAssignTeacher && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="class-teacher">Class teacher</Label>
                    <select
                      id="class-teacher"
                      className="h-10 w-full rounded-md border bg-background px-3"
                      value={form.classTeacherId}
                      onChange={(event) =>
                        setForm({ ...form, classTeacherId: event.target.value })
                      }
                    >
                      <option value="">Unassigned</option>
                      {options.teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.firstName} {teacher.lastName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setFormOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !options}>
                  {saving ? 'Saving…' : 'Save class'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {loading ? (
        <p role="status">Loading classes…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">School classes</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="p-3">
                  Class
                </th>
                <th scope="col" className="p-3">
                  Level
                </th>
                <th scope="col" className="p-3">
                  Teacher
                </th>
                <th scope="col" className="p-3">
                  Students / capacity
                </th>
                <th scope="col" className="p-3">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {classes.map((record) => (
                <tr key={record.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{record.name}</td>
                  <td className="p-3">{record.level?.name}</td>
                  <td className="p-3">
                    {record.classTeacher
                      ? `${record.classTeacher.firstName} ${record.classTeacher.lastName}`
                      : 'Unassigned'}
                  </td>
                  <td className="p-3">
                    {record._count.students} / {record.capacity}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Edit ${record.name}`}
                          onClick={() => openForm(record)}
                        >
                          Edit
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="destructive"
                          size="sm"
                          aria-label={`Delete ${record.name}`}
                          onClick={() => remove(record)}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {classes.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No classes are available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
