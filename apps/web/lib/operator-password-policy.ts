/**
 * Client-safe operator password policy utilities.
 *
 * This module contains only pure validation functions and constants that can
 * run in the browser. It deliberately does NOT import `argon2` (a Node-only
 * native module), so it can be safely imported by Client Components.
 */

/**
 * The shortest operator password accepted.
 *
 * Deliberately lower than `MIN_ADMIN_PASSWORD_LENGTH` (the tenant
 * administrator floor in `tools/tenant-cli/provision.ts`): an operator
 * credential is created once from the CLI and held by a person who already has
 * the platform, while school administrators are provisioned in bulk and choose
 * their own passwords through an emailed link. It is a floor and not the whole
 * policy: length is deliberately kept low because the console has no
 * composition rules of its own and adding some would be a rule nobody could
 * satisfy consistently, but composition is still required — a 6-character
 * password with no uppercase, no digit and no symbol is not acceptable even
 * here, because that is the difference between a short memorable credential
 * and a dictionary word.
 */
export const MIN_OPERATOR_PASSWORD_LENGTH = 6

/**
 * The composition rules an operator password must satisfy on top of the floor.
 *
 * Kept identical to the portal's `PASSWORD_COMPLEXITY` in spirit — uppercase,
 * lowercase, digit and symbol — because an operator credential reaches every
 * tenant in the fleet and deserves the same baseline as a school
 * administrator's.
 */
export const OPERATOR_PASSWORD_COMPLEXITY = {
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
} as const

/**
 * Whether a candidate password meets the floor.
 *
 * A predicate rather than a check buried inside `hashOperatorPassword`, because it
 * is the part worth asserting on its own: the refusal has to be provable without
 * first paying for a hash, and a caller that wants to validate before hashing has to
 * be able to ask.
 */
export function isAcceptableOperatorPassword(password: string): boolean {
  if (password.length < MIN_OPERATOR_PASSWORD_LENGTH) return false

  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasDigit = /\d/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)

  if (OPERATOR_PASSWORD_COMPLEXITY.requireUppercase && !hasUpper) return false
  if (OPERATOR_PASSWORD_COMPLEXITY.requireLowercase && !hasLower) return false
  if (OPERATOR_PASSWORD_COMPLEXITY.requireDigit && !hasDigit) return false
  if (OPERATOR_PASSWORD_COMPLEXITY.requireSymbol && !hasSymbol) return false

  return true
}