'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, Button, Badge,
  useToast, useConfirm,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Label, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Textarea,
} from '@novastar/shared-ui'
import {
  Plus, Search, CreditCard, MoreHorizontal, Edit2, Trash2,
  RefreshCw,
} from 'lucide-react'

interface FeeInvoice {
  id: string
  invoiceNumber: string
  totalAmount: string
  dueDate: string | null
  status: string
  createdAt: string
  student: { firstName: string; lastName: string } | null
}

export default function FeesPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [invoices, setInvoices] = useState<FeeInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<Array<{ code: string; name: string; instructions?: string }>>([])
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<FeeInvoice | null>(null)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    methodCode: '',
    reference: '',
    notes: '',
    momoPhone: '',
    transactionId: '',
  })
  const [submittingPayment, setSubmittingPayment] = useState(false)

  const fetchInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/finance/invoices?${params}`)
      if (res.ok) {
        const data = await res.json()
        setInvoices(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load invoices' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load invoices' })
    } finally {
      setLoading(false)
    }
  }, [search, toast])

  const fetchPaymentMethods = useCallback(async () => {
    try {
      const res = await fetch('/api/config')
      if (res.ok) {
        const data = await res.json()
        const methods = (data.entityTypes || []).filter((e: { type: string }) => e.type === 'payment_method')
        setPaymentMethods(methods.map((m: { code: string; name: string; instructions?: string }) => ({
          code: m.code,
          name: m.name,
          instructions: m.instructions,
        })))
      }
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      await fetchPaymentMethods()
    }
    load()
  }, [fetchPaymentMethods])

  useEffect(() => {
    const load = async () => {
      await fetchInvoices()
    }
    load()
  }, [fetchInvoices])

  const openPaymentDialog = (invoice: FeeInvoice) => {
    setSelectedInvoice(invoice)
    setPaymentForm({
      amount: '',
      methodCode: '',
      reference: '',
      notes: '',
      momoPhone: '',
      transactionId: '',
    })
    setPaymentDialogOpen(true)
  }

  const handlePaymentSubmit = async () => {
    if (!selectedInvoice) return
    const amount = parseFloat(paymentForm.amount)
    if (isNaN(amount) || amount <= 0) {
      toast.error({ title: 'Invalid amount', description: 'Please enter a valid amount' })
      return
    }
    if (!paymentForm.methodCode) {
      toast.error({ title: 'Missing method', description: 'Please select a payment method' })
      return
    }
    if (!paymentForm.reference) {
      toast.error({ title: 'Missing reference', description: 'Please enter a payment reference' })
      return
    }

    setSubmittingPayment(true)
    try {
      const res = await fetch(`/api/finance/invoices/${selectedInvoice.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: paymentForm.amount,
          methodCode: paymentForm.methodCode,
          reference: paymentForm.reference,
          notes: paymentForm.notes || undefined,
          momoPhone: paymentForm.momoPhone || undefined,
          transactionId: paymentForm.transactionId || undefined,
        }),
      })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Payment recorded successfully' })
        setPaymentDialogOpen(false)
        fetchInvoices()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to record payment' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to record payment' })
    } finally {
      setSubmittingPayment(false)
    }
  }

  const handleDelete = async (inv: FeeInvoice) => {
    const ok = await confirm({
      title: 'Delete Invoice?',
      description: `This will permanently delete invoice #${inv.invoiceNumber}. This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/finance/invoices/${inv.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Invoice deleted' })
        fetchInvoices()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete invoice' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete invoice' })
    }
  }

  const statusColors: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-800',
    PAID: 'bg-green-100 text-green-800',
    PARTIAL: 'bg-blue-100 text-blue-800',
    OVERDUE: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-gray-100 text-gray-800',
    DRAFT: 'bg-gray-100 text-gray-800',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Fees &amp; Payments</h1>
          <p className="text-sm text-muted-foreground">Manage invoices and record payments</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Generate Invoices
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (e.target.value.length >= 2 || e.target.value.length === 0) {
              fetchInvoices()
            }
          }}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Invoices ({invoices.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No invoices found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Student</th>
                    <th className="text-left py-2">Amount</th>
                    <th className="text-left py-2">Due Date</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Created</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t">
                      <td className="py-2">
                        {inv.student
                          ? `${inv.student.firstName} ${inv.student.lastName}`
                          : <span className="text-muted-foreground">Unassigned</span>}
                      </td>
                      <td className="py-2">{Number(inv.totalAmount)} GHS</td>
                      <td className="py-2 text-sm">
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '-'}
                      </td>
                      <td className="py-2">
                        <Badge className={statusColors[inv.status] || ''}>
                          {inv.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-sm text-muted-foreground">
                        {new Date(inv.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <Edit2 className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openPaymentDialog(inv)}>
                              Record Payment
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(inv)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record a payment for invoice #{selectedInvoice?.invoiceNumber || '—'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedInvoice && (
              <div className="text-sm">
                <span className="font-medium">Balance:</span> {Number(selectedInvoice.totalAmount)} GHS
              </div>
            )}
            <div className="space-y-2">
              <Label>Payment Method *</Label>
              <Select
                value={paymentForm.methodCode}
                onValueChange={(v) => setPaymentForm({ ...paymentForm, methodCode: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                {paymentMethods.map(m => (
                  <SelectItem key={m.code} value={m.code}>
                    {m.name}
                    {m.instructions && <span className="text-xs text-muted-foreground block">{m.instructions}</span>}
                  </SelectItem>
                ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (GHS) *</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Reference *</Label>
              <Input
                placeholder="Transaction reference"
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
              />
            </div>
            {paymentForm.methodCode === 'MTN_MOMO' && (
              <div className="space-y-2">
                <Label>MoMo Phone</Label>
                <Input
                  placeholder="0554416937"
                  value={paymentForm.momoPhone}
                  onChange={(e) => setPaymentForm({ ...paymentForm, momoPhone: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Transaction ID (optional)</Label>
              <Input
                placeholder="Bank/Terminal reference"
                value={paymentForm.transactionId}
                onChange={(e) => setPaymentForm({ ...paymentForm, transactionId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Additional notes..."
                value={paymentForm.notes}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </div>
            <Button
              onClick={handlePaymentSubmit}
              disabled={submittingPayment}
              className="w-full"
            >
              {submittingPayment ? 'Recording...' : 'Record Payment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Button
        variant="ghost"
        size="sm"
        onClick={fetchInvoices}
        disabled={loading}
        className="gap-2"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        Refresh
      </Button>
    </div>
  )
}
