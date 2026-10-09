// Currency (Ghana Cedis)

export function formatGHS(amount: number | string | null | undefined): string {
  const num = parseFloat(String(amount || 0))
  if (isNaN(num)) return '₵0.00'
  return `₵${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[₵,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Readable form of a Ghanaian phone number: `+233 55 441 6937`.
 *
 * Both accepted lengths are counted the way the NCC counts them, which is the
 * point of this function having been wrong:
 *
 * - the LOCAL form is TEN digits — `0` + a 2-digit network code + 7 digits, e.g.
 *   `0554416937`. That is what a parent types, and it is the local form of the
 *   example above;
 * - the INTERNATIONAL form is TWELVE — `233` + the same ten — e.g.
 *   `233554416937` or `+233 55 441 6937`.
 *
 * It used to gate the local arm on `length === 9`, which is off by one in the
 * dangerous direction twice over. A 10-digit number matched neither arm and was
 * returned unformatted, so the canonical form got no treatment at all; and a
 * 9-digit input was accepted as local and sliced into `+233 <2> <3> <3>` — a
 * NINE-digit national number, which is a different number rather than a shorter
 * way of writing this one. A parent reading that off the admissions review
 * screen and dialling it reaches nobody.
 *
 * Unrecognised input is returned unchanged. A number this function cannot parse
 * is one a human still has to be able to read and correct, so it is never
 * rewritten into something that merely looks formatted.
 */
export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return `+233 ${cleaned.slice(1, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`
  }
  if (cleaned.length === 12 && cleaned.startsWith('233')) {
    return `+233 ${cleaned.slice(3, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`
  }
  return phone
}