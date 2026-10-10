'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Input,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  useConfirm,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@novastar/shared-ui'
import { Plus, Search, Edit2, Trash2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Loader2, MoreHorizontal, Eye, Lock } from 'lucide-react'
import { EntityType, DEFAULT_ENTITY_REGISTRY } from '@novastar/shared-types'
import { formatDate } from '@novastar/shared-utils'
import { EntityForm } from './entity-form'
import { isLockedRecord, withAmendmentReason } from './amendment'

interface EntityListProps {
  entityType: EntityType
}

interface EntityListItem {
  id: string
  name: string
  code?: string
  [key: string]: unknown
}

/**
 * A rejected field, flattened out of the shape Zod's `format()` returns.
 *
 * The config routes answer a refused write with `{ error, issues }`, where `issues`
 * is a Zod field tree for a per-field problem and a plain list of sentences for a
 * cross-row one. `prefix` carries the field path down so a nested object reads as
 * `scale.bands.0.minScore` rather than as one anonymous message, and `_errors` is
 * the key Zod puts a field's own messages under, so it contributes the path as the
 * prefix instead of replacing it.
 */
function issueLines(issues: unknown, prefix = ''): string[] {
  if (Array.isArray(issues)) {
    return issues
      .filter((issue): issue is string => typeof issue === 'string')
      .map((message) => (prefix ? `${prefix}: ${message}` : message))
  }
  if (issues === null || typeof issues !== 'object') return []
  const lines: string[] = []
  for (const [key, value] of Object.entries(issues as Record<string, unknown>)) {
    const label = key === '_errors' ? prefix : prefix ? `${prefix}.${key}` : key
    lines.push(...issueLines(value, label))
  }
  return lines
}

/**
 * The server's own words for why a write failed, as one line a teacher can act on.
 *
 * This exists because nothing used to read them. `handleFormSubmit` closed the
 * dialog only on `res.ok` and said nothing otherwise, so a refusal — a rejected
 * `defaultWeight`, or the 500 every grading-scale GET, PATCH and DELETE used to
 * return — left the dialog sitting open looking like it was still saving.
 */
async function describeFailure(res: Response): Promise<string> {
  let payload: { error?: unknown; issues?: unknown } | null = null
  try {
    payload = (await res.json()) as { error?: unknown; issues?: unknown }
  } catch {
    payload = null
  }
  const summary =
    typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status})`
  const issues = issueLines(payload?.issues)
  return issues.length > 0 ? `${summary}: ${issues.join('; ')}` : summary
}

export function EntityList({ entityType }: EntityListProps) {
  const registry = DEFAULT_ENTITY_REGISTRY.find(e => e.type === entityType)
  const [data, setData] = useState<EntityListItem[]>([])
  const [meta, setMeta] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<string | null>(null)
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The amendment reason for the row being edited. Held here, not inside
  // `EntityForm`, because `handleFormSubmit` is what composes the PATCH body and
  // it must not save without the key when the row is locked.
  const [amendmentReason, setAmendmentReason] = useState('')
  const confirm = useConfirm()
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(meta.page),
        limit: String(meta.limit),
      })
      if (sort) params.set('sort', sort)
      params.set('order', order)
      if (search) params.set('search', search)

      const res = await fetch(`/api/config/${entityType}?${params}`)
      if (res.ok) {
        const json = await res.json()
        setData(json.data)
        setMeta(json.meta)
        setError(null)
      } else {
        setError(await describeFailure(res))
      }
    } catch (caught) {
      console.error('Fetch error:', caught)
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [entityType, meta.page, meta.limit, sort, order, search])

  useEffect(() => {
    const load = async () => {
      await fetchData()
    }
    load()
  }, [fetchData])

  const handleSort = (field: string) => {
    if (sort === field) {
      setOrder(order === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(field)
      setOrder('asc')
    }
  }

  const handleCreate = () => {
    setSelectedId(null)
    setEditMode(false)
    setError(null)
    setShowForm(true)
  }

  const handleEdit = (item: EntityListItem) => {
    setSelectedId(item.id)
    setEditMode(true)
    setError(null)
    setShowForm(true)
  }

  const handleView = (item: EntityListItem) => {
    setSelectedId(item.id)
    setEditMode(false)
    setError(null)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!await confirm({
      title: 'Are you sure?',
      description: 'This action cannot be undone.',
      variant: 'destructive',
    })) return

    try {
      const res = await fetch(`/api/config/${entityType}/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setError(null)
        fetchData()
      } else {
        setError(await describeFailure(res))
      }
    } catch (caught) {
      console.error('Delete error:', caught)
      setError('Could not reach the server. Check your connection and try again.')
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setSelectedId(null)
    setEditMode(false)
    setError(null)
    // Cleared on close, never on open: a reason belonging to the row just edited
    // would otherwise be sitting in the box when the next locked row is opened,
    // and would be sent as THAT row's justification without anybody typing it.
    setAmendmentReason('')
  }

  const handleFormSubmit = async (formData: Record<string, unknown>) => {
    // The row as it is stored, which is what decides whether a reason is owed.
    // Read from `data`, not from the submitted form, because the form's values are
    // the edit being requested and cannot themselves say whether this row is locked.
    const target = selectedId ? data.find((row) => row.id === selectedId) ?? null : null
    const body = withAmendmentReason(formData, {
      locked: isLockedRecord(target),
      reason: amendmentReason,
    })

    try {
      const res = editMode && selectedId
        ? await fetch(`/api/config/${entityType}/${selectedId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch(`/api/config/${entityType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })

      if (res.ok) {
        handleFormClose()
        fetchData()
      } else {
        // The dialog stays open with the reason on it. Closing it, or swallowing
        // the refusal, is what let a head teacher save a grading scale and be told
        // nothing when the write never happened.
        setError(await describeFailure(res))
      }
    } catch (caught) {
      console.error('Submit error:', caught)
      setError('Could not reach the server. Check your connection and try again.')
    }
  }

  // Get display columns from registry
  const displayFields = registry?.fields
    .filter(f => ['string', 'number', 'boolean', 'date', 'select'].includes(f.type))
    .slice(0, 5) || []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            {registry?.icon && <span className="text-xl">{registry.icon}</span>}
            {registry?.namePlural || entityType}
          </CardTitle>
        </div>
        {registry?.allowAdd && (
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Add {registry?.name}
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {error && !showForm && (
          <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {displayFields.map(field => (
                  <TableHead
                    key={field.key}
                    className="cursor-pointer hover:bg-muted"
                    onClick={() => handleSort(field.key)}
                  >
                    <div className="flex items-center gap-1">
                      {field.label}
                      {sort === field.key && (
                        order === 'asc' ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )
                      )}
                    </div>
                  </TableHead>
                ))}
                <TableHead className="w-10">
                  {/*
                    A dedicated Lock column rather than a badge inside a data
                    column, so lock state is visible while SCROLLING a wide table
                    instead of only on the first few fields.
                  */}
                  <span className="sr-only">Lock state</span>
                </TableHead>
                <TableHead className="w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={displayFields.length + 2} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={displayFields.length + 2} className="text-center py-8 text-muted-foreground">
                    No {registry?.namePlural?.toLowerCase() || 'records'} found
                  </TableCell>
                </TableRow>
              ) : (
                data.map(item => (
                  <TableRow key={item.id} className="hover:bg-muted/50">
                    {displayFields.map(field => (
                      <TableCell key={field.key}>
                        {field.type === 'boolean' ? (
                          <Badge variant={item[field.key] ? 'default' : 'outline'}>
                            {item[field.key] ? 'Yes' : 'No'}
                          </Badge>
                        ) : field.type === 'date' ? (
                          formatDate(item[field.key] as string)
                        ) : (
                          String(item[field.key] ?? '—')
                        )}
                      </TableCell>
                    ))}
                    {/*
                      Locked means "cannot be edited silently", NOT "cannot be
                      edited", so the row is not disabled and the Edit item is not
                      removed: the lock migration is explicit that converting a
                      data-entry mistake into a support escalation is the worse
                      outcome. What this cell carries is the promise that an edit
                      will be recorded, with a reason.
                    */}
                    <TableCell>
                      {isLockedRecord(item) ? (
                        <Badge variant="outline" className="gap-1">
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          Locked
                        </Badge>
                      ) : (
                        <span className="sr-only">Not locked</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleView(item)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </DropdownMenuItem>
                          {registry?.allowEdit && (
                            <DropdownMenuItem onClick={() => handleEdit(item)}>
                              <Edit2 className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          {registry?.allowDelete && !item.isSystem && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(item.id)}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">
              Page {meta.page} of {meta.totalPages} ({meta.total} total)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMeta(m => ({ ...m, page: m.page - 1 }))}
                disabled={!meta.hasPrev}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMeta(m => ({ ...m, page: m.page + 1 }))}
                disabled={!meta.hasNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Form Dialog */}
        <Dialog open={showForm} onOpenChange={open => !open && handleFormClose()}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editMode ? `Edit ${registry?.name}` : `Create ${registry?.name}`}
              </DialogTitle>
              <DialogDescription>
                {editMode
                  ? `Update the ${registry?.name.toLowerCase()} details`
                  : `Add a new ${registry?.name.toLowerCase()}`}
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <EntityForm
              entityType={entityType}
              initialData={editMode && selectedId ? data.find(d => d.id === selectedId) ?? null : null}
              onSubmit={handleFormSubmit}
              onClose={handleFormClose}
              readOnly={!editMode}
              amendmentReason={amendmentReason}
              onAmendmentReasonChange={setAmendmentReason}
            />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}