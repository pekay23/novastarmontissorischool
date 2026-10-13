/**
 * The seed provisions no accounts, and that is a property worth pinning.
 *
 * The seed used to create headmaster@nms.com, admin@nms.com and the sp@dev.com
 * platform operator from password variables, which put a credential for an
 * all-permissions account into the environment of whatever ran the seed. Both
 * the accounts and the password reads are now gone, and a test is the only
 * thing that keeps them from coming back with the next "just add it to the
 * seed" request: the cost of the regression is invisible until somebody's
 * password rotates.
 *
 * These assertions read the seed's source rather than running it, because
 * running it needs a database and the thing being pinned is what the seed does
 * with credentials — which is visible without one.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const seedSource = readFileSync(join(import.meta.dir, '..', 'index.ts'), 'utf-8')

describe('the seed creates no accounts', () => {
  it('reads no password variable', () => {
    // The variables that are gone from turbo.json and .env.example must not
    // come back under any spelling.
    for (const name of [
      'SEED_HEADMASTER_PASSWORD',
      'SEED_PORTAL_ADMIN_PASSWORD',
      'SEED_ALLOW_DEFAULT_PASSWORDS',
      'resolveSeedCredentials',
      'SeedCredentialsError',
    ]) {
      expect(seedSource).not.toContain(name)
    }

    // And nothing password-shaped is read from the environment at all. The
    // header documents TENANT_ADMIN_PASSWORD and PLATFORM_OPERATOR_PASSWORD
    // as the CLI's own prompt fallback — a name in a comment is fine, a read
    // of one is not.
    const envReads = seedSource.match(/process\.env\.\w+/g) ?? []
    const credentialReads = envReads.filter((name) => /PASSWORD|SECRET|TOKEN|PRIVATE_KEY/.test(name))
    expect(credentialReads).toEqual([])

    // The committed fallback literals are gone with the module that guarded
    // them.
    expect(seedSource).not.toContain('Head@2026')
    expect(seedSource).not.toContain('Admin@2026')
  })

  it('hashes no password', () => {
    // argon2id is how a password becomes a passwordHash; the seed no longer
    // needs either.
    expect(seedSource).not.toContain('Bun.password.hash')
    expect(seedSource).not.toContain('passwordHash')
  })

  it('writes no User or PlatformOperator row', () => {
    expect(seedSource).not.toContain('prisma.user.upsert')
    expect(seedSource).not.toContain('prisma.user.create')
    expect(seedSource).not.toContain('prisma.platformOperator')
  })

  it('names the CLI that does create them', () => {
    // An operator who has just seeded a fresh database is one command away
    // from a usable portal, and the seed is where they learn it.
    expect(seedSource).toContain('tenant -- user --email headmaster@nms.com')
    expect(seedSource).toContain('tenant -- operator --email sp@dev.com')
  })

  it('resolves the headmaster it still writes data for, instead of creating one', () => {
    // The staff row and the sample news item both need an author; they look the
    // account up and skip when it is absent, which is the difference between
    // "no accounts" and "no data that depends on one".
    expect(seedSource).toContain('headmaster@nms.com')
    expect(seedSource).toContain('headmasterUser')
    expect(seedSource).not.toContain('adminUser')
  })

  it('leaves no credential-refusal machinery behind', () => {
    // The refusal, its tests and the password verifier existed only to serve
    // the accounts that are gone; a leftover import here would be a compile
    // error, which is the point of asserting the files are gone too.
    expect(existsSync(join(import.meta.dir, '..', 'credentials.ts'))).toBe(false)
    expect(existsSync(join(import.meta.dir, '..', 'verify-admin.ts'))).toBe(false)
    expect(seedSource).not.toContain('SeedCredentialsError')
  })
})
