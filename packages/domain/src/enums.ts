export enum InvoiceStatus { PENDING='PENDING', PARTIAL='PARTIAL', PAID='PAID', OVERDUE='OVERDUE', CANCELLED='CANCELLED', WAIVED='WAIVED' } 
export enum PaymentStatus { PENDING='PENDING', COMPLETED='COMPLETED', FAILED='FAILED', REFUNDED='REFUNDED', REVERSED='REVERSED' } 
export const { PENDING, PARTIAL, PAID, OVERDUE, CANCELLED, WAIVED } = InvoiceStatus; 
export const { COMPLETED, FAILED, REFUNDED, REVERSED } = PaymentStatus;


/**
 * The boundary between Prisma's generated enum and this module's copy.
 *
 * @prisma/client generates its own InvoiceStatus with the same members, and a
 * Prisma row's field is typed as that copy, so it is not assignable to this one
 * without a conversion -- which is the honest move: the value arrives as a plain
 * string and is accepted only when it names a real member.
 */
const INVOICE_STATUSES = new Set<string>(Object.values(InvoiceStatus))

export function toInvoiceStatus(value: string | null | undefined): InvoiceStatus {
  return value !== null && value !== undefined && INVOICE_STATUSES.has(value)
    ? (value as InvoiceStatus)
    : InvoiceStatus.PENDING
}
