import { argon2id, hash as argon2Hash, verify as argon2Verify } from 'argon2'

/**
 * Operator password hashing for the control plane, on the Node runtime.
 *
 * WHY NOT `Bun.password`
 * ----------------------
 * `tools/tenant-cli/provision.ts` and `tools/seed` hash with `Bun.password`, which
 * is the right primitive on Bun — and `apps/super-admin` runs on Node under
 * `next start`, where `Bun` does not exist. `lib/provision.ts:53-63` already
 * carries `assertBunRuntimeForAdminHashing()` for exactly this reason and fails
 * closed rather than dying on `TypeError: Bun is not defined` mid-transaction.
 * An operator credential is on the sign-in path, so it cannot carry that same
 * guard: it must work on the runtime this app actually runs on.
 *
 * WHY `argon2` AND NOT A SECOND HASH
 * ----------------------------------
 * `apps/portal/lib/password.ts` verifies with the `argon2` npm package, so this
 * is the same implementation on the same platform: hashes written here verify
 * there and vice versa, and there is exactly one argon2 dependency to reason
 * about. `tools/seed` writes hashes with `Bun.password`, which also emits
 * argon2id — which is why the OWASP parameters are stated explicitly below
 * rather than inherited: a hash carries its own parameters in the PHC string, so
 * verification reads them back out of the stored value and never needs them here.
 *
 * THE PARAMETERS, AND WHY THEY ARE NOT DEFAULTS
 * ---------------------------------------------
 * OWASP's second recommended argon2id configuration: 19 MiB of memory, two
 * iterations, one lane. `argon2`'s library defaults are lower on timeCost, and a
 * console credential deserves more than the floor — an operator account reaches
 * every tenant in the fleet, so guessing one is the highest-value password attack
 * in the system. Stating them here also means the cost does not drift when the
 * library is upgraded.
 */
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

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
 * administrator's. The literal is duplicated rather than imported for the same
 * reason `MIN_OPERATOR_PASSWORD_LENGTH` is: this module runs on Node under
 * `next start` and cannot reach the portal's `@/` alias, and importing across
 * that boundary would mean adding a dependency from the console to the
 * portal.
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

/**
 * Hashes an operator password. Never logs, echoes or returns the input.
 *
 * Refuses a password below `MIN_OPERATOR_PASSWORD_LENGTH` by throwing, rather than
 * hashing it and letting the weak credential exist. There is no in-console way to
 * create an operator — `novastar-tenant operator` is the only writer — so this is
 * the app's half of the same rule: if a future route ever grows one, it cannot mint
 * a credential this module will not accept. The CLI carries the same floor as its
 * own literal, since it cannot import this module.
 *
 * `@prisma` column length is unbounded (`String` maps to `TEXT`), so there is no
 * truncation to guard against — but the value is deliberately kept out of every
 * message this module produces, because a hash in an error string is a hash in a log
 * aggregator.
 */
export async function hashOperatorPassword(password: string): Promise<string> {
  if (!isAcceptableOperatorPassword(password)) {
    if (password.length < MIN_OPERATOR_PASSWORD_LENGTH) {
      throw new Error(
        `An operator password must be at least ${MIN_OPERATOR_PASSWORD_LENGTH} characters. ` +
          'Nothing was hashed.',
      )
    }
    throw new Error(
      'An operator password must contain an uppercase letter, a lowercase letter, a number ' +
        'and a symbol. Nothing was hashed.',
    )
  }
  return argon2Hash(password, ARGON2_OPTIONS)
}

/**
 * Verifies a candidate against a stored argon2id hash, or returns `false`.
 *
 * Never throws, for two reasons, and both are load-bearing:
 *
 * 1. A malformed or unknown stored hash must fail *closed*. A corrupt row is a
 *    refused sign-in, not a 500 that tells the caller their account is broken and
 *    a stack trace that names the query.
 * 2. Callers run this on every attempt, including attempts against no account at
 *    all (see `DUMMY_PASSWORD_HASH` in `admin-auth.ts`), so a throw would have to
 *    be caught at every call site and one that forgot would turn a refused sign-in
 *    into a server error.
 *
 * `argon2Verify` is constant time in the comparison it performs, which is why it
 * replaces the previous `timingSafeEqual`-on-hashed-strings approach for the
 * credential itself: there is no `===` on any secret anywhere in this module.
 */
export async function verifyOperatorPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2Verify(passwordHash, password)
  } catch (error) {
    // Logged, not returned: the sign-in path needs a boolean, and a malformed hash
    // is an operational fact an operator must be able to find.
    console.error('[super-admin] Operator password verification failed:', error)
    return false
  }
}