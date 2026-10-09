// Validation Helpers

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Whether `phone` is a Ghanaian number this codebase is willing to accept.
 *
 * The two accepted forms and why they are ten and twelve digits are set out on
 * `formatPhone`, and this predicate has to agree with it — a form that accepts
 * what `formatPhone` cannot render, or refuses what it renders perfectly, is
 * worse than having neither. It previously gated the local arm on nine digits,
 * so `0554416937` — a complete, dialable number, and the form Ghanaians write —
 * was rejected while the nine-digit `054416937` was accepted.
 *
 * Length and leading digit only. This is a shape gate, not a proof of
 * allocation: it does not check the network code against the NCC's list, so it
 * accepts `0000000000`. That is deliberate — the question this answers is
 * "did the parent type something shaped like a Ghanaian number", and a stricter
 * check would refuse real numbers from ranges this code has no list of.
 */
export function validateGhanaPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '')
  return (cleaned.length === 10 && cleaned.startsWith('0')) ||
         (cleaned.length === 12 && cleaned.startsWith('233'))
}

export function validateGhanaID(id: string): boolean {
  // Ghanaian ID: 10 or 12 digits
  const cleaned = id.replace(/\D/g, '')
  return cleaned.length === 10 || cleaned.length === 12
}