import { nextId } from '../ids'
import { now } from '../time'
import { toMinorUnits } from '../money'

export type InvoiceStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'WAIVED'
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'REVERSED'

export interface BuildFeeCategoryOverrides {
  id?: string
  tenantId?: string
  schoolId?: string | null
  code?: string
  name?: string
  isRecurring?: boolean
  defaultMandatory?: boolean
  sortOrder?: number
  createdAt?: Date
  updatedAt?: Date
}

export function buildFeeCategory(overrides: BuildFeeCategoryOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_fee_category'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? null,
    code: overrides.code ?? `FC${nextId('fc').replace('test_fc_', '').padStart(3, '0')}`,
    name: overrides.name ?? 'Tuition Fee',
    isRecurring: overrides.isRecurring ?? true,
    defaultMandatory: overrides.defaultMandatory ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildPaymentMethodConfigOverrides {
  id?: string
  tenantId?: string
  schoolId?: string | null
  code?: string
  name?: string
  instructions?: string | null
  isEnabled?: boolean
  sortOrder?: number
  providerConfig?: Record<string, unknown> | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildPaymentMethodConfig(overrides: BuildPaymentMethodConfigOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_payment_method'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? null,
    code: overrides.code ?? 'mtn-momo',
    name: overrides.name ?? 'MTN Mobile Money',
    instructions: overrides.instructions ?? null,
    isEnabled: overrides.isEnabled ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    providerConfig: overrides.providerConfig ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildFeeStructureOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  name?: string
  academicYearId?: string
  termId?: string | null
  classLevelId?: string
  isActive?: boolean
  createdAt?: Date
  updatedAt?: Date
}

export function buildFeeStructure(overrides: BuildFeeStructureOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_fee_structure'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    name: overrides.name ?? 'Primary Tuition 2024-2025',
    academicYearId: overrides.academicYearId ?? nextId('test_academic_year'),
    termId: overrides.termId ?? null,
    classLevelId: overrides.classLevelId ?? nextId('test_class_level'),
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildFeeLineItemOverrides {
  id?: string
  tenantId?: string
  feeStructureId?: string
  categoryId?: string
  amount?: number
  isMandatory?: boolean
  dueDate?: Date | null
  sortOrder?: number
}

export function buildFeeLineItem(overrides: BuildFeeLineItemOverrides = {}): Record<string, unknown> {
  return {
    id: overrides.id ?? nextId('test_fee_line_item'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    feeStructureId: overrides.feeStructureId ?? nextId('test_fee_structure'),
    categoryId: overrides.categoryId ?? nextId('test_fee_category'),
    amount: overrides.amount ?? toMinorUnits(500),
    isMandatory: overrides.isMandatory ?? true,
    dueDate: overrides.dueDate ?? null,
    sortOrder: overrides.sortOrder ?? 0,
  }
}

export interface BuildInvoiceOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  studentId?: string
  termId?: string
  invoiceNumber?: string
  totalAmount?: number
  paidAmount?: number
  balance?: number
  status?: InvoiceStatus
  dueDate?: Date
  issuedAt?: Date
  paidAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildInvoice(overrides: BuildInvoiceOverrides = {}): Record<string, unknown> {
  const totalAmount = overrides.totalAmount ?? toMinorUnits(1500)
  const paidAmount = overrides.paidAmount ?? 0
  const seq = nextId('invoice_seq')
  return {
    id: overrides.id ?? nextId('test_invoice'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    studentId: overrides.studentId ?? nextId('test_student'),
    termId: overrides.termId ?? nextId('test_term'),
    invoiceNumber: overrides.invoiceNumber ?? `INV-${Date.now().toString().slice(-6)}-${seq.replace('invoice_seq_', '').padStart(4, '0')}`,
    totalAmount,
    paidAmount,
    balance: overrides.balance ?? totalAmount - paidAmount,
    status: overrides.status ?? 'PENDING',
    dueDate: overrides.dueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    issuedAt: overrides.issuedAt ?? now(),
    paidAt: overrides.paidAt ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}

export interface BuildPaymentOverrides {
  id?: string
  tenantId?: string
  schoolId?: string
  invoiceId?: string | null
  studentId?: string
  amount?: number
  methodId?: string
  reference?: string
  transactionId?: string | null
  momoPhone?: string | null
  status?: PaymentStatus
  paidAt?: Date
  recordedById?: string
  notes?: string | null
  createdAt?: Date
  updatedAt?: Date
}

export function buildPayment(overrides: BuildPaymentOverrides = {}): Record<string, unknown> {
  const seq = nextId('payment_seq')
  return {
    id: overrides.id ?? nextId('test_payment'),
    tenantId: overrides.tenantId ?? nextId('test_tenant'),
    schoolId: overrides.schoolId ?? nextId('test_school'),
    invoiceId: overrides.invoiceId ?? null,
    studentId: overrides.studentId ?? nextId('test_student'),
    amount: overrides.amount ?? toMinorUnits(500),
    methodId: overrides.methodId ?? nextId('test_payment_method'),
    reference: overrides.reference ?? `REF-${Date.now().toString().slice(-6)}-${seq.replace('payment_seq_', '').padStart(6, '0')}`,
    transactionId: overrides.transactionId ?? null,
    momoPhone: overrides.momoPhone ?? null,
    status: overrides.status ?? 'COMPLETED',
    paidAt: overrides.paidAt ?? now(),
    recordedById: overrides.recordedById ?? nextId('test_user'),
    notes: overrides.notes ?? null,
    createdAt: overrides.createdAt ?? now(),
    updatedAt: overrides.updatedAt ?? now(),
  }
}