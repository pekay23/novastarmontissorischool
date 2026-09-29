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
import { Plus, Search, Edit2, Trash2, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Loader2, MoreHorizontal, Eye } from 'lucide-react'
import { EntityType, DEFAULT_ENTITY_REGISTRY } from '@novastar/shared-types'
import { formatDate } from '@novastar/shared-utils'
import { EntityForm } from './entity-form'

interface EntityListProps {
  entityType: EntityType
}

interface EntityListItem {
  id: string
  name: string
  code?: string
  [key: string]: unknown
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
      }
    } catch (error) {
      console.error('Fetch error:', error)
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
    setShowForm(true)
  }

  const handleEdit = (item: EntityListItem) => {
    setSelectedId(item.id)
    setEditMode(true)
    setShowForm(true)
  }

  const handleView = (item: EntityListItem) => {
    setSelectedId(item.id)
    setEditMode(false)
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
        fetchData()
      }
    } catch (error) {
      console.error('Delete error:', error)
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setSelectedId(null)
    setEditMode(false)
  }

  const handleFormSubmit = async (formData: Record<string, unknown>) => {
    try {
      if (editMode && selectedId) {
        const res = await fetch(`/api/config/${entityType}/${selectedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })
        if (res.ok) {
          handleFormClose()
          fetchData()
        }
      } else {
        const res = await fetch(`/api/config/${entityType}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })
        if (res.ok) {
          handleFormClose()
          fetchData()
        }
      }
    } catch (error) {
      console.error('Submit error:', error)
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
                <TableHead className="w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={displayFields.length + 1} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={displayFields.length + 1} className="text-center py-8 text-muted-foreground">
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
            <EntityForm
              entityType={entityType}
              initialData={editMode && selectedId ? data.find(d => d.id === selectedId) ?? null : null}
              onSubmit={handleFormSubmit}
              onClose={handleFormClose}
              readOnly={!editMode}
            />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}