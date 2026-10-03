import { http, HttpResponse } from 'msw'
import { invoiceFixtures } from '../fixtures/invoices'

const FINANCE_BASE = '/api/finance'

export const financeHandlers = [
  // GET /api/finance/invoices
  http.get(`${FINANCE_BASE}/invoices`, ({ request }) => {
    const url = new URL(request.url)
    const studentId = url.searchParams.get('studentId')
    const status = url.searchParams.get('status')
    const page = Number(url.searchParams.get('page') ?? '1')
    const limit = Number(url.searchParams.get('limit') ?? '50')

    let invoices = [...invoiceFixtures]
    if (studentId) {
      invoices = invoices.filter((i) => i.studentId === studentId)
    }
    if (status) {
      invoices = invoices.filter((i) => i.status === status)
    }

    const start = (page - 1) * limit
    const paginated = invoices.slice(start, start + limit)

    return HttpResponse.json({
      data: paginated,
      meta: {
        page,
        limit,
        total: invoices.length,
        totalPages: Math.ceil(invoices.length / limit),
        hasNext: start + limit < invoices.length,
        hasPrev: page > 1,
      },
    })
  }),

  // POST /api/finance/invoices (generate invoices for class)
  http.post(`${FINANCE_BASE}/invoices`, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    const newInvoices = Array.from({ length: 5 }, (_, i) => ({
      id: `test_invoice_${invoiceFixtures.length + i + 1}`,
      tenantId: 'test_tenant_1',
      schoolId: 'test_school_1',
      studentId: `test_student_${i + 1}`,
      termId: body.termId as string,
      invoiceNumber: `INV-${Date.now()}-${String(i + 1).padStart(4, '0')}`,
      totalAmount: 150000,
      paidAmount: 0,
      balance: 150000,
      status: 'PENDING',
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      issuedAt: new Date().toISOString(),
      paidAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      student: { firstName: 'Test', lastName: `Student ${i + 1}`, studentId: `STU${String(i + 1).padStart(4, '0')}` },
      term: { name: 'Term 1' },
      payments: [],
    }))
    invoiceFixtures.push(...newInvoices)
    return HttpResponse.json({
      success: true,
      count: newInvoices.length,
      invoices: newInvoices,
    })
  }),

  // DELETE /api/finance/invoices/:id
  http.delete(`${FINANCE_BASE}/invoices/:id`, ({ params }) => {
    const index = invoiceFixtures.findIndex((i) => i.id === params.id)
    if (index === -1) {
      return HttpResponse.json(
        { error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' },
        { status: 404 }
      )
    }
    const invoice = invoiceFixtures[index]
    if (invoice.payments && invoice.payments.length > 0) {
      return HttpResponse.json(
        { error: 'Cannot delete invoice with recorded payments', code: 'INVOICE_HAS_PAYMENTS' },
        { status: 409 }
      )
    }
    invoiceFixtures.splice(index, 1)
    return HttpResponse.json({ success: true })
  }),

  // GET /api/finance/invoices/:id/payments
  http.get(`${FINANCE_BASE}/invoices/:id/payments`, ({ params }) => {
    const invoice = invoiceFixtures.find((i) => i.id === params.id)
    if (!invoice) {
      return HttpResponse.json(
        { error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' },
        { status: 404 }
      )
    }
    return HttpResponse.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount,
        paidAmount: invoice.paidAmount,
        balance: invoice.balance,
        status: invoice.status,
      },
      payments: invoice.payments ?? [],
    })
  }),

  // POST /api/finance/invoices/:id/payments
  http.post(`${FINANCE_BASE}/invoices/:id/payments`, async ({ params, request }) => {
    const invoice = invoiceFixtures.find((i) => i.id === params.id)
    if (!invoice) {
      return HttpResponse.json(
        { error: 'Invoice not found', code: 'INVOICE_NOT_FOUND' },
        { status: 404 }
      )
    }
    const body = await request.json() as Record<string, unknown>
    const methodCode = body.methodCode as string
    const methodName = methodCode === 'mtn-momo' ? 'MTN Mobile Money' : methodCode === 'bank-transfer' ? 'Bank Transfer' : 'Cash'
    const payment = {
      id: `test_payment_${Date.now()}`,
      amount: body.amount as number,
      paidAt: new Date().toISOString(),
      method: { name: methodName, code: methodCode },
      recordedBy: { name: 'Admin User', email: 'admin@test.example' },
    }
    invoice.payments = invoice.payments ?? []
    invoice.payments.push(payment)
    invoice.paidAmount += body.amount as number
    invoice.balance = invoice.totalAmount - invoice.paidAmount
    invoice.status = invoice.balance <= 0 ? 'PAID' : 'PARTIAL'
    invoice.updatedAt = new Date().toISOString()
    return HttpResponse.json(payment, { status: 201 })
  }),

  // GET /api/finance/payment-methods
  http.get(`${FINANCE_BASE}/payment-methods`, () => {
    return HttpResponse.json({
      data: [
        { id: 'test_pm_1', code: 'mtn-momo', name: 'MTN Mobile Money', isEnabled: true },
        { id: 'test_pm_2', code: 'bank-transfer', name: 'Bank Transfer', isEnabled: true },
        { id: 'test_pm_3', code: 'cash', name: 'Cash', isEnabled: true },
      ],
    })
  }),

  // Unknown finance routes return 404-shaped body
  http.all(`${FINANCE_BASE}/*`, () => {
    return HttpResponse.json(
      { error: 'Not found', code: 'FINANCE_ROUTE_NOT_FOUND' },
      { status: 404 }
    )
  }),
]