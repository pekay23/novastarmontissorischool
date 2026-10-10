import { hash as argon2Hash, verify as argon2Verify } from 'argon2'
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_COMPLEXITY,
  type PasswordComplexity,
  meetsPasswordComplexity,
  PASSWORD_COMPLEXITY_LABEL,
  meetsPasswordPolicy,
} from './password-policy'

/**
 * Password verification and hashing for the portal server runtime.
 *
 * `tools/seed/index.ts` and `tools/tenant-cli/provision.ts` run under Bun and
 * write argon2id PHC strings via `Bun.password.hash`. The portal, however, runs
 * on the Node.js runtime (Next's `next dev` / `next start`), where the global
 * `Bun` object does not exist — so hashing must go through a Node-compatible
 * argon2 implementation.
 *
 * argon2 hashes are self-describing (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`),
 * so verification reads the parameters out of the stored hash and needs none of
 * its own. Hashing is the opposite case: the parameters have to be chosen, and
 * they have to be the ones Bun already wrote, or a hash produced here and a hash
 * produced by the seed would differ in cost for no reason.
 *
 * Not empirically re-measured here — correctness does not depend on it, only cost
 * does — so a deployment that wants to move both writers to stronger parameters
 * should change Bun's side and this side in the same commit.
 */

/**
 * argon2id cost parameters, pinned to Bun's own `argon2id` defaults
 * (`Bun.password.hash(pw, { algorithm: 'argon2id' })` ⇒ m=19456 KiB, t=2, p=1).
 *
 * Pinned explicitly because `argon2` (the npm package) ships DIFFERENT defaults —
 * m=65536, t=3, p=4 — and it is those defaults that would otherwise apply here.
 * The two sets are not interchangeable in cost, so leaving them implicit would
 * mean portal-issued passwords are ~3× more expensive to verify than
 * seed-issued ones for no security gain. Verification is unaffected either way:
 * `argon2Verify` reads m/t/p from the hash it is given.
 */
export const ARGON2ID_PARAMS = {
  type: 2, // argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

// Re-export client-safe utilities
export {
  MIN_PASSWORD_LENGTH,
  PASSWORD_COMPLEXITY,
  type PasswordComplexity,
  meetsPasswordComplexity,
  PASSWORD_COMPLEXITY_LABEL,
  meetsPasswordPolicy,
}

/**
 * Hashes a password with argon2id at `ARGON2ID_PARAMS`.
 *
 * Argon2id specifically: it is the hybrid of the two variants, resistant to both
 * GPU cracking and side-channel attacks, and it is what the seed already writes.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2ID_PARAMS)
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2Verify(passwordHash, password)
  } catch (error) {
    // A malformed/unknown hash must fail closed, never 500 the sign-in request.
    console.error('[password] Argon2 verification failed:', error)
    return false
  }
}