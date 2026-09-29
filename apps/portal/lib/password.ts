import { verify as argon2Verify } from 'argon2'

/**
 * Password verification for the portal server runtime.
 *
 * `tools/seed/index.ts` runs under Bun and writes argon2id PHC strings via
 * `Bun.password.hash`. The portal, however, runs on the Node.js runtime (Next's
 * `next dev` / `next start`), where the global `Bun` object does not exist — so
 * verification must go through a Node-compatible argon2 implementation.
 *
 * argon2 hashes are self-describing (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`),
 * so the parameters chosen by the seed are read back out of the stored hash and
 * do not need to be configured here.
 */
export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await argon2Verify(passwordHash, password)
  } catch (error) {
    // A malformed/unknown hash must fail closed, never 500 the sign-in request.
    console.error('[password] Argon2 verification failed:', error)
    return false
  }
}
