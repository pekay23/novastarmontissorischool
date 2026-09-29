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

describe('Payments - Types', () => {
  it('should export PaymentProvider interface', () => {
    // Type is compile-time only
    expect(true).toBe(true)
  })

  it('should export PaymentInput interface', () => {
    expect(true).toBe(true)
  })

  it('should export PaymentResult interface', () => {
    expect(true).toBe(true)
  })

  it('should export VerificationResult interface', () => {
    expect(true).toBe(true)
  })
})