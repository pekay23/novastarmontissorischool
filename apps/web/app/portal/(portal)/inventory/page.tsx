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
  Textarea,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@novastar/shared-ui'
import { InventoryStatus } from '@novastar/database'
import {
  Plus,
  Search,
  MoreHorizontal,
  Edit2,
  Trash2,
  Save,
  X,
  Package,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

interface InventoryItem {
  id: string
  name: string
  description: string | null
  category: { name: string } | null
  quantity: number
  minQuantity: number
  unit: string | null
  location: string | null
  purchasePrice: number | null
  supplier: string | null
  status: InventoryStatus
  createdAt: string
  updatedAt: string
}

interface InventoryForm {
  name: string
  description: string
  quantity: string
  minQuantity: string
  unit: string
  location: string
  purchasePrice: string
  supplier: string
}

const STATUS_COLORS: Record<InventoryStatus, string> = {
  IN_STOCK: 'bg-green-100 text-green-800',
  LOW_STOCK: 'bg-amber-100 text-amber-800',
  OUT_OF_STOCK: 'bg-red-100 text-red-800',
  DISCONTINUED: 'bg-gray-100 text-gray-800',
}

export default function InventoryPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [form, setForm] = useState<InventoryForm>({
    name: '',
    description: '',
    quantity: '0',
    minQuantity: '0',
    unit: '',
    location: '',
    purchasePrice: '',
    supplier: '',
  })

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/portal/api/inventory/${params.toString() ? `?${params}` : ''}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load inventory' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load inventory' })
    } finally {
      setLoading(false)
    }
  }, [search, toast])

  useEffect(() => {
    const load = async () => {
      await fetchItems()
    }
    load()
  }, [fetchItems])

  const handleNew = () => {
    setEditingItem(null)
    setForm({
      name: '',
      description: '',
      quantity: '0',
      minQuantity: '0',
      unit: '',
      location: '',
      purchasePrice: '',
      supplier: '',
    })
    setDialogOpen(true)
  }

  const handleEdit = (item: InventoryItem) => {
    setEditingItem(item)
    setForm({
      name: item.name,
      description: item.description || '',
      quantity: String(item.quantity),
      minQuantity: String(item.minQuantity),
      unit: item.unit || '',
      location: item.location || '',
      purchasePrice: item.purchasePrice ? String(item.purchasePrice) : '',
      supplier: item.supplier || '',
    })
    setDialogOpen(true)
  }

  const handleDelete = async (item: InventoryItem) => {
    const ok = await confirm({
      title: 'Delete Item?',
      description: `This will permanently delete "${item.name}". This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/portal/api/inventory/${item.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Item deleted' })
        void fetchItems()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete item' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete item' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.name.trim()) {
      toast.error({ title: 'Error', description: 'Name is required' })
      return
    }

    const qty = Number(form.quantity) || 0
    const minQty = Number(form.minQuantity) || 0

    let status: InventoryStatus
    if (qty === 0) status = 'OUT_OF_STOCK'
    else if (qty <= minQty) status = 'LOW_STOCK'
    else status = 'IN_STOCK'

    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || null,
      quantity: qty,
      minQuantity: minQty,
      unit: form.unit || null,
      location: form.location || null,
      purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : null,
      supplier: form.supplier || null,
      status,
    }

    try {
      let res: Response
      if (editingItem) {
        res = await fetch(`/portal/api/inventory/${editingItem.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/portal/api/inventory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      if (res.ok) {
        toast.success({
          title: 'Success',
          description: editingItem ? 'Item updated' : 'Item created',
        })
        setDialogOpen(false)
        setEditingItem(null)
        void fetchItems()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to save item' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save item' })
    }
  }

  const lowStockCount = items.filter(
    (i) => i.quantity <= i.minQuantity && i.quantity > 0,
  ).length
  const outOfStockCount = items.filter((i) => i.quantity === 0).length
  const totalValue = items.reduce(
    (sum, i) => sum + (i.purchasePrice || 0) * i.quantity,
    0,
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Manage school supplies, equipment, and stock levels
          </p>
        </div>
        <Button className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" />
          New Item
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{items.length}</p>
                <p className="text-xs text-muted-foreground">Total Items</p>
              </div>
              <Package className="h-6 w-6 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-amber-600">
                  {lowStockCount}
                </p>
                <p className="text-xs text-muted-foreground">Low Stock</p>
              </div>
              <AlertTriangle className="h-6 w-6 text-amber-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-red-600">
                  {outOfStockCount}
                </p>
                <p className="text-xs text-muted-foreground">Out of Stock</p>
              </div>
              <TrendingDown className="h-6 w-6 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  GHS {totalValue.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">Total Value</p>
              </div>
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search inventory items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Items ({items.length})</CardTitle>
          <CardDescription>
            {outOfStockCount} out of stock, {lowStockCount} low stock
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No inventory items found</p>
              <p className="text-sm mt-1">Click "New Item" to add one</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Item</th>
                    <th className="text-left py-2">Category</th>
                    <th className="text-center py-2">Quantity</th>
                    <th className="text-center py-2">Min</th>
                    <th className="text-right py-2">Value</th>
                    <th className="text-center py-2">Status</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const value =
                      (item.purchasePrice || 0) * item.quantity
                    return (
                      <tr key={item.id} className="border-t">
                        <td className="py-2">
                          <div className="font-medium">{item.name}</div>
                          {item.description && (
                            <p className="text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          )}
                          {item.location && (
                            <p className="text-xs text-muted-foreground">
                              Location: {item.location}
                            </p>
                          )}
                        </td>
                        <td className="py-2 text-sm">
                          {item.category?.name || '-'}
                        </td>
                        <td className="py-2 text-center">
                          {item.quantity}
                          {item.unit && (
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              {item.unit}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-center text-sm text-muted-foreground">
                          {item.minQuantity}
                        </td>
                        <td className="py-2 text-right text-sm">
                          {value > 0 ? `GHS ${value.toFixed(2)}` : '-'}
                        </td>
                        <td className="py-2 text-center">
                          <Badge
                            variant="outline"
                            className={STATUS_COLORS[item.status]}
                          >
                            {item.status}
                          </Badge>
                        </td>
                        <td className="py-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEdit(item)}>
                                <Edit2 className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(item)}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inventory Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {editingItem ? 'Edit Item' : 'New Item'}
            </DialogTitle>
            <DialogDescription>
              {editingItem
                ? 'Update inventory item details below.'
                : 'Fill in the item details below.'}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto max-h-[calc(90vh-160px)]">
            <form id="item-form" onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={3}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="0"
                    value={form.quantity}
                    onChange={(e) =>
                      setForm({ ...form, quantity: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minQuantity">Minimum Quantity</Label>
                  <Input
                    id="minQuantity"
                    type="number"
                    min="0"
                    value={form.minQuantity}
                    onChange={(e) =>
                      setForm({ ...form, minQuantity: e.target.value })
                    }
                    placeholder="Low stock threshold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="unit">Unit</Label>
                  <Input
                    id="unit"
                    value={form.unit}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    placeholder="e.g., pcs, boxes, sets"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={form.location}
                    onChange={(e) =>
                      setForm({ ...form, location: e.target.value })
                    }
                    placeholder="e.g., Store Room A"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="purchasePrice">Purchase Price (per unit)</Label>
                  <Input
                    id="purchasePrice"
                    type="number"
                    step="0.01"
                    value={form.purchasePrice}
                    onChange={(e) =>
                      setForm({ ...form, purchasePrice: e.target.value })
                    }
                    placeholder="e.g., 25.50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplier">Supplier</Label>
                  <Input
                    id="supplier"
                    value={form.supplier}
                    onChange={(e) =>
                      setForm({ ...form, supplier: e.target.value })
                    }
                  />
                </div>
              </div>
            </form>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" form="item-form">
              <Save className="h-4 w-4 mr-2" />
              {editingItem ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
