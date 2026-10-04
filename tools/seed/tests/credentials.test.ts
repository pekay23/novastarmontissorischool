/**
 * Tests for the seed's credential refusal and its credential write paths.
 *
 * Pure logic only: no database, no Prisma client, no network. That is the whole
 * point of the credential module living in its own file — the previous shape could
 * only be observed by seeding a real school's database, so it had no test at all.
 *
 * The two suites below read `index.ts` as text. That is deliberate: "no write can
 * precede the refusal" is an ordering claim about the file, and so is "the update
 * branch of the admin upsert touches no credential" — both are claims about which
 * keys sit inside an object literal, and a behavioural test for either would have to
 * run the seed against a live database. Same technique, and the same reasoning, as
 * `apps/portal/tests/repair-attendance-duplicates.test.ts`. The upsert slices are
 * parsed by brace-matching rather than by regex over the whole file, so a `//` or a
 * `{` inside a string literal cannot make an assertion pass for the wrong reason.
 */
import { describe, expect, it } from 'bun:test'
import {
  ALLOW_DEFAULT_PASSWORDS_VAR,
  DEFAULT_HEADMASTER_PASSWORD,
  DEFAULT_PORTAL_ADMIN_PASSWORD,
  HEADMASTER_PASSWORD_VAR,
  PORTAL_ADMIN_PASSWORD_VAR,
  resolveSeedCredentials,
  SeedCredentialsError,
} from '../credentials'

const STRONG = 'Chosen-By-An-Operator!42'
const LOCAL_URL = 'postgresql://postgres:postgres@localhost:5432/novastar'
const REMOTE_URL = 'postgresql://u:p@ep-tiny-firefly-abc.us-east-2.aws.neon.tech/neondb'

const HEADMASTER_EMAIL = 'headmaster@novastarmontessori.com'
const PORTAL_ADMIN_EMAIL = 'admin@novastarmontessori.com'

/** Read once, at module scope: `describe` callbacks are not async. */
const seedSource = await Bun.file(new URL('../index.ts', import.meta.url)).text()
const credentialsSource = await Bun.file(new URL('../credentials.ts', import.meta.url)).text()

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { DATABASE_URL: LOCAL_URL, ...overrides } as NodeJS.ProcessEnv
}

/** Drops `//` comments line by line, so an assertion cannot be satisfied by prose. */
function withoutLineComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

/**
 * Every `prisma.user.upsert({ ... })` call in the seed, in file order.
 *
 * Bounded by the line that closes the call at main()'s own indentation — `  })`.
 * Nothing nested inside an upsert is indented that little, so the terminator is
 * unambiguous without a full parser.
 */
function userUpserts(): string[] {
  const MARKER = 'prisma.user.upsert({'
  const found: string[] = []
  let at = seedSource.indexOf(MARKER)
  while (at >= 0) {
    const end = seedSource.indexOf('\n  })', at)
    expect(end).toBeGreaterThan(-1)
    found.push(withoutLineComments(seedSource.slice(at, end)))
    at = seedSource.indexOf(MARKER, at + MARKER.length)
  }
  return found
}

/** The upsert that provisions `email`, comments already stripped. */
function upsertFor(email: string): string {
  const match = userUpserts().find((call) => call.includes(`email: '${email}'`))
  expect(match).toBeDefined()
  return match as string
}

/**
 * The body of the `key: { ... }` object in a slice, by brace counting.
 *
 * Fails rather than returning a partial match if the object does not close, so a
 * future edit that changes the call's shape produces a broken test rather than a
 * vacuous one.
 */
function objectBodyFor(source: string, key: string): string {
  const at = source.indexOf(`${key}: {`)
  expect(at).toBeGreaterThan(-1)
  const open = source.indexOf('{', at)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  throw new Error(`the ${key} object in the upsert does not close`)
}

describe('a password the operator chose is used verbatim', () => {
  it('returns both values with no substitution', () => {
    const creds = resolveSeedCredentials(
      env({
        [HEADMASTER_PASSWORD_VAR]: STRONG,
        [PORTAL_ADMIN_PASSWORD_VAR]: STRONG,
      }),
    )
    expect(creds.headmasterPassword).toBe(STRONG)
    expect(creds.portalAdminPassword).toBe(STRONG)
    expect(creds.usingCommittedDefaults).toBe(false)
  })

  it('does not trim or rewrite the value — it is hashed exactly as given', () => {
    const creds = resolveSeedCredentials(
      env({
        [HEADMASTER_PASSWORD_VAR]: '  padded but deliberate  ',
        [PORTAL_ADMIN_PASSWORD_VAR]: STRONG,
      }),
    )
    expect(creds.headmasterPassword).toBe('  padded but deliberate  ')
  })
})

describe('a missing password refuses the seed', () => {
  it('refuses when both are absent, naming both variables', () => {
    let thrown: unknown
    try {
      resolveSeedCredentials(env({}))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(SeedCredentialsError)
    const variables = (thrown as SeedCredentialsError).variables
    expect(variables).toEqual([HEADMASTER_PASSWORD_VAR, PORTAL_ADMIN_PASSWORD_VAR])
    // The operator has to be able to find the name to act on it.
    expect((thrown as Error).message).toContain(HEADMASTER_PASSWORD_VAR)
    expect((thrown as Error).message).toContain(PORTAL_ADMIN_PASSWORD_VAR)
  })

  it('refuses when only one is absent, naming that one', () => {
    let thrown: unknown
    try {
      resolveSeedCredentials(env({ [HEADMASTER_PASSWORD_VAR]: STRONG }))
    } catch (e) {
      thrown = e
    }
    expect((thrown as SeedCredentialsError).variables).toEqual([PORTAL_ADMIN_PASSWORD_VAR])
  })

  it('treats a blank or whitespace-only value as absent', () => {
    // An empty string is not a password. Accepting one would hash "" into a row
    // and produce an account that signs in with no credential at all.
    expect(() =>
      resolveSeedCredentials(env({ [HEADMASTER_PASSWORD_VAR]: '', [PORTAL_ADMIN_PASSWORD_VAR]: STRONG })),
    ).toThrow(SeedCredentialsError)
    expect(() =>
      resolveSeedCredentials(env({ [HEADMASTER_PASSWORD_VAR]: '   ', [PORTAL_ADMIN_PASSWORD_VAR]: STRONG })),
    ).toThrow(SeedCredentialsError)
  })

  it('never returns a committed literal on the refusing path', () => {
    // The specific defect: a public password installed because a variable was
    // missing. Assert the literals are absent from the refusal path rather than
    // merely trusting that the throw happened.
    try {
      resolveSeedCredentials(env({}))
      throw new Error('expected a refusal')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedCredentialsError)
      expect((e as Error).message).not.toContain(DEFAULT_HEADMASTER_PASSWORD)
      expect((e as Error).message).not.toContain(DEFAULT_PORTAL_ADMIN_PASSWORD)
    }
  })
})

describe('the refusal is actionable', () => {
  it('prints the export line for each missing variable and the opt-in', () => {
    try {
      resolveSeedCredentials(env({}))
      throw new Error('expected a refusal')
    } catch (e) {
      const message = (e as Error).message
      expect(message).toContain(`export ${HEADMASTER_PASSWORD_VAR}=`)
      expect(message).toContain(`export ${PORTAL_ADMIN_PASSWORD_VAR}=`)
      expect(message).toContain(ALLOW_DEFAULT_PASSWORDS_VAR)
      // "Nothing was written" is the sentence that makes the refusal safe to
      // believe; without it an operator has to guess whether to clean up.
      expect(message).toContain('Nothing was written.')
    }
  })

  it('reports the target host, so "my variable was ignored" is answerable', () => {
    try {
      resolveSeedCredentials(env({ DATABASE_URL: REMOTE_URL }))
      throw new Error('expected a refusal')
    } catch (e) {
      const message = (e as Error).message
      expect(message).toContain('ep-tiny-firefly-abc.us-east-2.aws.neon.tech')
      expect(message).toContain('NOT local')
    }
  })
})

describe('the opt-in needs both locks', () => {
  it('accepts the fallbacks when the opt-in is set and the host is local', () => {
    const creds = resolveSeedCredentials(env({ [ALLOW_DEFAULT_PASSWORDS_VAR]: '1' }))
    expect(creds.headmasterPassword).toBe(DEFAULT_HEADMASTER_PASSWORD)
    expect(creds.portalAdminPassword).toBe(DEFAULT_PORTAL_ADMIN_PASSWORD)
    expect(creds.usingCommittedDefaults).toBe(true)
    // The operator is told where the password came from, by name and not by
    // value, so the log records that a published literal was used.
    expect(creds.headmasterSource).toContain(ALLOW_DEFAULT_PASSWORDS_VAR)
    expect(creds.headmasterSource).not.toContain(DEFAULT_HEADMASTER_PASSWORD)
  })

  it('refuses against a remote host even with the opt-in set', () => {
    // This is the lock that matters. A flag alone would leave a published
    // administrator password one .env entry away from production.
    expect(() =>
      resolveSeedCredentials(env({ [ALLOW_DEFAULT_PASSWORDS_VAR]: '1', DATABASE_URL: REMOTE_URL })),
    ).toThrow(SeedCredentialsError)
  })

  it('refuses against an unresolvable host even with the opt-in set', () => {
    for (const url of [undefined, '', 'not-a-url']) {
      expect(() =>
        resolveSeedCredentials(
          env({ [ALLOW_DEFAULT_PASSWORDS_VAR]: '1', DATABASE_URL: url, DIRECT_URL: undefined }),
        ),
      ).toThrow(SeedCredentialsError)
    }
  })

  it('accepts every local host spelling the repo already trusts', () => {
    // Bracketed for `::1`, because a raw IPv6 literal in a URL is a parse error
    // and the lock has to agree with the host `tools/migrate` would classify.
    const cases: Record<string, string> = {
      localhost: 'postgresql://u:p@localhost/db',
      '127.0.0.1': 'postgresql://u:p@127.0.0.1/db',
      '127.1.2.3': 'postgresql://u:p@127.1.2.3/db',
      '::1': 'postgresql://u:p@[::1]/db',
      'app.localhost': 'postgresql://u:p@app.localhost/db',
      'host.docker.internal': 'postgresql://u:p@host.docker.internal/db',
    }
    for (const url of Object.values(cases)) {
      expect(() => resolveSeedCredentials(env({ [ALLOW_DEFAULT_PASSWORDS_VAR]: '1', DATABASE_URL: url }))).not.toThrow()
    }
  })

  it('only accepts the literal string "1" — nothing inferable', () => {
    // Same rule as SKIP_PRODUCTION_GUARD and MIGRATE_SKIP_DOTENV: a variable in
    // the environment is not a decision a person made, so it has to be spelled.
    for (const value of ['0', 'true', 'yes', '', ' 1', '1 ']) {
      expect(() =>
        resolveSeedCredentials(env({ [ALLOW_DEFAULT_PASSWORDS_VAR]: value })),
      ).toThrow(SeedCredentialsError)
    }
  })

  it('still prefers a real password over the fallback', () => {
    const creds = resolveSeedCredentials(
      env({ [ALLOW_DEFAULT_PASSWORDS_VAR]: '1', [PORTAL_ADMIN_PASSWORD_VAR]: STRONG }),
    )
    expect(creds.portalAdminPassword).toBe(STRONG)
    expect(creds.headmasterPassword).toBe(DEFAULT_HEADMASTER_PASSWORD)
    expect(creds.usingCommittedDefaults).toBe(true)
  })
})

describe('the refusal happens before any write', () => {
  it('resolves credentials as the FIRST statement of main(), not merely an early one', () => {
    // Sliced to main()'s body on purpose. `upsertGradingScale` is defined above
    // main() and contains `await prisma.gradingScale.findFirst(...)`, so a
    // whole-file offset comparison would be measuring a function that is only
    // ever called later — it would pass for the wrong reason and fail for
    // another. What has to hold is that nothing *runs* before the refusal.
    const mainAt = seedSource.indexOf('async function main()')
    expect(mainAt).toBeGreaterThan(-1)
    const body = seedSource.slice(mainAt)
    const credentialsAt = body.indexOf('const seedCredentials = resolveSeedCredentials()')
    expect(credentialsAt).toBeGreaterThan(-1)

    // Everything between the opening brace and the call must be whitespace and
    // comments. Stripped by hand rather than by regex over the whole file, so
    // a `//` inside a string literal cannot eat the assertion.
    const braceAt = body.indexOf('{')
    const before = body.slice(braceAt + 1, credentialsAt)
    const withoutComments = before
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
      .trim()
    expect(withoutComments).toBe('')

    // And the first Prisma touch inside main() is after it.
    expect(credentialsAt).toBeLessThan(body.indexOf('prisma.tenant.upsert('))
  })

  it('resolves credentials before the tenant and school upserts specifically', () => {
    // The two writes the brief called out, named rather than inferred, so this
    // test fails loudly if someone renames the call and the generic check above
    // silently degrades into comparing two offsets that happen to be in order.
    expect(seedSource).toContain('const seedCredentials = resolveSeedCredentials()')
    expect(seedSource.indexOf('const seedCredentials = resolveSeedCredentials()')).toBeLessThan(
      seedSource.indexOf('await prisma.tenant.upsert('),
    )
    expect(seedSource.indexOf('const seedCredentials = resolveSeedCredentials()')).toBeLessThan(
      seedSource.indexOf('await prisma.school.upsert('),
    )
  })

  it('leaves no inline fallback in the credential read itself', () => {
    // A guard that exists only at the top of main() while the old
    // `process.env.X || 'literal'` line still sits further down would be a guard
    // someone can route around by editing one function. So: no direct read of
    // either variable from `process.env` (the header comment may name them; the
    // code may not), and neither literal anywhere in the file.
    expect(seedSource).not.toContain('process.env.SEED_HEADMASTER_PASSWORD')
    expect(seedSource).not.toContain('process.env.SEED_PORTAL_ADMIN_PASSWORD')
    expect(seedSource).not.toContain(DEFAULT_HEADMASTER_PASSWORD)
    expect(seedSource).not.toContain(DEFAULT_PORTAL_ADMIN_PASSWORD)
  })

  it('exits non-zero on a refusal without printing a stack trace', () => {
    expect(seedSource).toContain('process.exitCode = 1')
    expect(seedSource).toContain('if (e instanceof SeedCredentialsError) {')
  })
})

describe('credentials are provisioned on create and never re-credentialed', () => {
  it('seeds both passwords into the create branches', () => {
    // Provisioning is the one half that is allowed to write a credential: an
    // account that does not exist yet has no password and cannot sign in.
    for (const email of [HEADMASTER_EMAIL, PORTAL_ADMIN_EMAIL]) {
      expect(objectBodyFor(upsertFor(email), 'create')).toContain('passwordHash')
    }
  })

  it('writes no credential into the admin update branch, only role and active', () => {
    // The defect this file now guards. `passwordHash` in this branch meant every
    // re-seed rotated a real account's password back to the seeded value, silently,
    // which is a credential change nobody asked for and nobody was told about.
    const update = objectBodyFor(upsertFor(PORTAL_ADMIN_EMAIL), 'update')
    expect(update).not.toContain('passwordHash')
    expect(update).not.toContain('passwordChangedAt')
    // Still there on purpose: a role rename or a suspension must not go stale just
    // because it is not a credential. Asserted so a future "simplification" that
    // empties this branch to match the headmaster's is caught.
    expect(update).toContain('roleId:')
    expect(update).toContain('isActive: true')
  })

  it('leaves the headmaster update branch empty', () => {
    expect(objectBodyFor(upsertFor(HEADMASTER_EMAIL), 'update').trim()).toBe('')
  })

  it('does not flag mustChangePassword before email delivery exists', () => {
    // Every other credential writer sets it — `tools/tenant-cli/commands/user.ts`,
    // `commands/operator.ts`, `packages/auth/invite.ts` — so this omission reads
    // like an oversight and will be "fixed" by someone. It is a decision.
    //
    // `apps/portal/proxy.ts:182-184` redirects any flagged session to
    // `/set-password`, which without a token renders "This page needs a setup
    // link" and disables its submit button; `POST /api/auth/set-password` refuses
    // with 409 `already-has-password` for an account that already holds a
    // password, so an invitation cannot rescue it; and the documented way out,
    // `/forgot-password`, needs `RESEND_API_KEY`, which is unset. An account
    // flagged by this seed would sign in, reach no portal page, and have no
    // recovery — worse than the silent rotation it would fix.
    //
    // When email delivery exists, delete this test and set the flag on both create
    // branches. The dependency to watch is `RESEND_API_KEY` plus a verified
    // sending domain, not a change of mind.
    for (const email of [HEADMASTER_EMAIL, PORTAL_ADMIN_EMAIL]) {
      const call = upsertFor(email)
      expect(objectBodyFor(call, 'create')).not.toContain('mustChangePassword')
      expect(objectBodyFor(call, 'update')).not.toContain('mustChangePassword')
    }
  })
})

describe('a developer who changed a password variable is told what happened', () => {
  // The seed no longer applies `SEED_PORTAL_ADMIN_PASSWORD` to an existing account,
  // so changing it and re-seeding leaves the old password working. That is correct
  // — a re-run must not re-credential — but silently, it looks exactly like a seed
  // bug, and it is the failure mode that gets filed as one. Both accounts say the
  // same sentence, naming the command that does re-credential.
  it('names the tenant-CLI rotate command, with the address, for both accounts', () => {
    for (const email of [HEADMASTER_EMAIL, PORTAL_ADMIN_EMAIL]) {
      expect(seedSource).toContain(`novastar-tenant user --email ${email} --rotate`)
    }
  })

  it('states that the password was not applied, rather than only hinting at it', () => {
    // Both log lines, not one: the asymmetry is what this suite exists to end, and
    // an account that logs nothing is the account someone gets locked out of.
    const notApplied = seedSource.match(/NOT applied/g) ?? []
    expect(notApplied).toHaveLength(2)
  })
})

describe('the committed fallbacks are unreachable, and the code says why', () => {
  // Both locks have to open, and on this project the host half has no host to
  // admit: the Prisma client is built with `@prisma/adapter-neon`, which speaks
  // SQL-over-HTTP, so a local `postgres:16` container cannot serve the schema at
  // all and the only usable database is Neon — remote by definition. A lock that
  // cannot open is the desired outcome, reached by a property of the driver, but
  // only while the code records it. Otherwise the next reader protects a guarantee
  // that does not exist, or relaxes a host gate that is the only thing between a
  // published password and production.
  it('the refusal withdraws the opt-in instead of leaving the operator to retry', () => {
    try {
      resolveSeedCredentials(env({}))
      throw new Error('expected a refusal')
    } catch (e) {
      const message = (e as Error).message
      expect(message).toContain('cannot open')
      expect(message).toContain('SQL-over-HTTP')
      // The variable is still named, so an operator who already knows it is not
      // left wondering which of the two locks failed.
      expect(message).toContain(ALLOW_DEFAULT_PASSWORDS_VAR)
    }
  })

  it('records the engine reason and the three honest ways out', () => {
    expect(credentialsSource).toContain('@prisma/adapter-neon')
    expect(credentialsSource).toContain('PostgreSQL wire protocol')
    // The lock is not to be removed and not to be weakened; the comment has to
    // name which of those is the bug.
    expect(credentialsSource).toContain('Never by relaxing the host gate')
    expect(credentialsSource).toContain('Delete the literals and the opt-in')
  })
})