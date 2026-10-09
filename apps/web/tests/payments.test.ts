import { describe, it, expect } from 'bun:test'
import { 
  MTNMoMoProvider, 
  BankTransferProvider, 
  CashProvider,
  PAYMENT_PROVIDERS,
  getProvider,
  PaymentService,
  reconcilePayments,
} from '@novastar/payments'
import { buildTenant, buildSchool, buildFeeCategory, buildInvoice, buildPayment, buildPaymentMethodConfig } from './factories'
import { toMinorUnits, fromMinorUnits, addMinorUnits, subMinorUnits, mulMinorUnits, divMinorUnits, formatGHS } from './factories/money'

describe('Payments - Provider Classes', () => {
  it('should export MTNMoMoProvider class', () => {
    expect(MTNMoMoProvider).toBeDefined()
    expect(typeof MTNMoMoProvider).toBe('function')
  })

  it('should export BankTransferProvider class', () => {
    expect(BankTransferProvider).toBeDefined()
    expect(typeof BankTransferProvider).toBe('function')
  })

  it('should export CashProvider class', () => {
    expect(CashProvider).toBeDefined()
    expect(typeof CashProvider).toBe('function')
  })
})

describe('Payments - Provider Registry', () => {
  it('should export PAYMENT_PROVIDERS object', () => {
    expect(PAYMENT_PROVIDERS).toBeDefined()
    expect(PAYMENT_PROVIDERS['mtn-momo']).toBeInstanceOf(MTNMoMoProvider)
    expect(PAYMENT_PROVIDERS['bank-transfer']).toBeInstanceOf(BankTransferProvider)
    expect(PAYMENT_PROVIDERS['cash']).toBeInstanceOf(CashProvider)
  })

  it('should export getProvider function', () => {
    expect(typeof getProvider).toBe('function')
  })

  it('should retrieve MTN MoMo provider', () => {
    const provider = getProvider('mtn-momo')
    expect(provider).toBeInstanceOf(MTNMoMoProvider)
    expect(provider.id).toBe('mtn-momo')
    expect(provider.name).toBe('MTN Mobile Money')
  })

  it('should retrieve Bank Transfer provider', () => {
    const provider = getProvider('bank-transfer')
    expect(provider).toBeInstanceOf(BankTransferProvider)
    expect(provider.id).toBe('bank-transfer')
    expect(provider.name).toBe('Bank Transfer')
  })

  it('should retrieve Cash provider', () => {
    const provider = getProvider('cash')
    expect(provider).toBeInstanceOf(CashProvider)
    expect(provider.id).toBe('cash')
    expect(provider.name).toBe('Cash')
  })

  it('should throw for unknown provider', () => {
    expect(() => getProvider('unknown' as never)).toThrow('Payment provider "unknown" not found')
  })
})

describe('Payments - Payment Service', () => {
  it('should export PaymentService class', () => {
    expect(PaymentService).toBeDefined()
    expect(typeof PaymentService).toBe('function')
  })

  it('should have static processPayment method', () => {
    expect(typeof PaymentService.processPayment).toBe('function')
  })

  it('should have static verifyPayment method', () => {
    expect(typeof PaymentService.verifyPayment).toBe('function')
  })

  it('should have static generatePaymentQR method', () => {
    expect(typeof PaymentService.generatePaymentQR).toBe('function')
  })
})

describe('Payments - Reconciliation', () => {
  it('should export reconcilePayments function', () => {
    expect(typeof reconcilePayments).toBe('function')
  })
})

// The `PaymentProvider` / `PaymentInput` / `PaymentResult` /
// `VerificationResult` interfaces used to have four tests here whose entire body
// was `expect(true).toBe(true)`, commented "Type is compile-time only". They were
// removed rather than fixed: an interface is erased at runtime, so the only way
// to test one is to compile against it, and `tsc --noEmit` on this package
// already does that. A test that cannot fail is worse than no test, because it
// counts toward coverage and implies a guarantee that nothing checks.
// `tsconfig` covers the types; see `packages/payments/tsconfig.json`.

describe('Payments - test-data factories and money helpers', () => {
  // These cover `@novastar/testing`, NOT the payments package: nothing in
  // `@novastar/payments` uses a factory, and this file is the only importer of
  // either package in the workspace. They live here because `packages/testing`
  // has no test suite of its own, so this is the only place these helpers are
  // checked at all. If that package ever grows a `test` task, this block belongs
  // there and should move.
  //
  // The money assertions below pin LITERAL minor-unit counts rather than round-
  // tripping through `toMinorUnits`. `expect(invoice.totalAmount).toBe(
  // toMinorUnits(1500))` is `x === x`: scaling `toMinorUnits` by a thousand
  // leaves both sides scaled together and the test green while every stored
  // amount is wrong by 1000x.

  it('should build a valid fee category', () => {
    const tenant = buildTenant()
    const feeCategory = buildFeeCategory({ tenantId: tenant.id, code: 'TUITION', name: 'Tuition Fee' })
    expect(feeCategory.id).toMatch(/^test_fee_category_\d+$/)
    expect(feeCategory.tenantId).toBe(tenant.id)
    expect(feeCategory.code).toBe('TUITION')
    expect(feeCategory.name).toBe('Tuition Fee')
    expect(feeCategory.isRecurring).toBe(true)
    expect(feeCategory.defaultMandatory).toBe(true)
  })

  it('should build a valid payment method config', () => {
    const tenant = buildTenant()
    const method = buildPaymentMethodConfig({ tenantId: tenant.id, code: 'mtn-momo', name: 'MTN Mobile Money' })
    expect(method.id).toMatch(/^test_payment_method_\d+$/)
    expect(method.tenantId).toBe(tenant.id)
    expect(method.code).toBe('mtn-momo')
    expect(method.name).toBe('MTN Mobile Money')
    expect(method.isEnabled).toBe(true)
  })

  it('should build a valid invoice', () => {
    const tenant = buildTenant()
    const school = buildSchool({ tenantId: tenant.id })
    const invoice = buildInvoice({ tenantId: tenant.id, schoolId: school.id, totalAmount: toMinorUnits(1500) })
    expect(invoice.id).toMatch(/^test_invoice_\d+$/)
    expect(invoice.tenantId).toBe(tenant.id)
    expect(invoice.schoolId).toBe(school.id)
    // GHS 1,500.00 in minor units. A literal, so a mis-scaled `toMinorUnits`
    // cannot scale the expectation along with the value under test.
    expect(invoice.totalAmount).toBe(150_000)
    expect(invoice.paidAmount).toBe(0)
    expect(invoice.balance).toBe(150_000)
    expect(invoice.status).toBe('PENDING')
    expect(invoice.invoiceNumber).toMatch(/^INV-\d+-\d+$/)
  })

  it('should build a valid payment', () => {
    const tenant = buildTenant()
    const school = buildSchool({ tenantId: tenant.id })
    const payment = buildPayment({ tenantId: tenant.id, schoolId: school.id, amount: toMinorUnits(500) })
    expect(payment.id).toMatch(/^test_payment_\d+$/)
    expect(payment.tenantId).toBe(tenant.id)
    expect(payment.schoolId).toBe(school.id)
    expect(payment.amount).toBe(50_000)
    expect(payment.status).toBe('COMPLETED')
    expect(payment.reference).toMatch(/^REF-\d+-\d+$/)
  })

  it('should handle GHS minor-unit arithmetic', () => {
    expect(toMinorUnits(10.50)).toBe(1050)
    expect(fromMinorUnits(1050)).toBe(10.50)
    expect(addMinorUnits(1000, 500)).toBe(1500)
    expect(subMinorUnits(1500, 500)).toBe(1000)
    expect(mulMinorUnits(1000, 1.5)).toBe(1500)
    expect(divMinorUnits(1500, 3)).toBe(500)
  })

  it('should format GHS amounts correctly', () => {
    // toMinorUnits(1500) = 150,000 cents = 1,500 GHS
    expect(formatGHS(toMinorUnits(1500))).toBe('GH₵1500.00')
    expect(formatGHS(toMinorUnits(15.50))).toBe('GH₵15.50')
    expect(formatGHS(toMinorUnits(0))).toBe('GH₵0.00')
    expect(formatGHS(-toMinorUnits(10))).toBe('-GH₵10.00')
  })

  it('should produce deterministic IDs across multiple calls', () => {
    const tenant = buildTenant()
    const invoice1 = buildInvoice({ tenantId: tenant.id })
    const invoice2 = buildInvoice({ tenantId: tenant.id })
    expect(invoice1.id).not.toBe(invoice2.id)
    expect(invoice1.id).toMatch(/^test_invoice_\d+$/)
    expect(invoice2.id).toMatch(/^test_invoice_\d+$/)
  })
})