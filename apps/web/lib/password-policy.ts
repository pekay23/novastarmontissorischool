/**
 * Client-safe password policy utilities.
 *
 * This module contains only pure validation functions and constants that can
 * run in the browser. It deliberately does NOT import `argon2` (a Node-only
 * native module), so it can be safely imported by Client Components.
 */

/**
 * The shortest password the portal will store.
 *
 * Matches `MIN_ADMIN_PASSWORD_LENGTH` in `tools/tenant-cli/provision.ts`, so an
 * administrator can rotate their own password from the portal with the same rule
 * the provisioning CLI enforces, and no account can be created by one tool that
 * the other would refuse.
 */
export const MIN_PASSWORD_LENGTH = 8

/**
 * The composition rules a password must satisfy on top of the length floor.
 *
 * Length alone is the weakest property an attacker can measure, and it is the
 * only one that costs nothing to check. These rules are deliberately simple —
 * they are enforced on both the client and the server, and the server's word is
 * the one that counts — because a policy nobody can satisfy consistently is a
 * policy that gets bypassed.
 *
 * The categories are the four a user can actually type without a special
 * character map: uppercase, lowercase, digit, and symbol. A symbol is anything
 * outside the basic Latin alphabet and the digits — it is not a curated set,
 * because curating one is how a list becomes a list of passwords nobody can
 * remember and everyone writes down.
 */
export const PASSWORD_COMPLEXITY = {
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
} as const

export type PasswordComplexity = typeof PASSWORD_COMPLEXITY

/**
 * Whether a candidate password satisfies the composition rules.
 *
 * Pure and side-effect free so it can be asserted on its own: the refusal has
 * to be provable without first paying for a hash.
 */
export function meetsPasswordComplexity(password: string): boolean {
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasDigit = /\d/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)

  if (PASSWORD_COMPLEXITY.requireUppercase && !hasUpper) return false
  if (PASSWORD_COMPLEXITY.requireLowercase && !hasLower) return false
  if (PASSWORD_COMPLEXITY.requireDigit && !hasDigit) return false
  if (PASSWORD_COMPLEXITY.requireSymbol && !hasSymbol) return false

  return true
}

/**
 * A short, human-readable summary of what a password needs.
 *
 * Used in form labels and error messages so the rule is stated once and cannot
 * drift between the two places it appears.
 */
export const PASSWORD_COMPLEXITY_LABEL =
  'at least 8 characters including an uppercase letter, a lowercase letter, a number and a symbol'

/**
 * The full policy check: length floor plus composition rules.
 */
export function meetsPasswordPolicy(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && meetsPasswordComplexity(password)
}