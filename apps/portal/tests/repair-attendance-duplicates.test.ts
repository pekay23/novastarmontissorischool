import { describe, it, expect, mock } from 'bun:test'

/**
 * Guards on `scripts/repair-attendance-duplicates.ts --apply`.
 *
 * The script's `main` is behind `import.meta.main`, so importing this module
 * cannot start a destructive run and nothing here needs a database. What is
 * under test is the decision logic: which target counts as production, what the
 * operator is asked to type, and that no part of the connection string can reach
 * the output.
 *
 * The reason this needs a test at all is that there is no local database to be
 * careless against. `packages/database` builds its client with `PrismaNeon`, so
 * `DATABASE_URL` names the live Neon host whether the operator is on their
 * laptop or on a deploy machine — a mistake here deletes live attendance rows.
 */

mock.module('server-only', () => ({}))
mock.module('@/lib/prisma', () => ({
  prisma: {
    attendanceStudent: { deleteMany: mock(async () => ({ count: 0 })) },
    $queryRaw: mock(async () => []),
    $transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    $disconnect: mock(async () => {}),
  },
}))

const { resolveDatabaseTarget, confirmationToken } = await import(
  '../scripts/repair-attendance-duplicates'
)

describe('--apply refuses a production target without an explicit second flag', () => {
  it('treats the live Neon host as production', () => {
    // The real shape from .env.example. A Neon host is a live database, so
    // `--apply` against it must not be one keystroke away.
    const target = resolveDatabaseTarget(
      'postgresql://USER:PASSWORD@ep-abc123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require',
    )

    expect(target).not.toBeNull()
    expect(target?.isProduction).toBe(true)
  })

  it('treats any non-loopback host as production, including unlisted providers', () => {
    // Default-deny. An allow-list that had to name every provider hostname would
    // be a list to keep current, and every entry on it a way to delete live rows.
    for (const host of [
      'db.example.com',
      'localhost.evil.example',
      'neon.tech',
      '10.0.0.5',
      'ep-abc.us-east-1.aws.neon.tech',
    ]) {
      expect(`${host}: ${resolveDatabaseTarget(`postgresql://u:p@${host}/db`)?.isProduction}`).toBe(
        `${host}: true`,
      )
    }
  })

  it('treats a loopback host as not production', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'db.localhost']) {
      expect(`${host}: ${resolveDatabaseTarget(`postgresql://u:p@${host}/db`)?.isProduction}`).toBe(
        `${host}: false`,
      )
    }
  })

  it('refuses an absent or unparseable URL rather than guessing', () => {
    // An unidentifiable target is not a safe target.
    expect(resolveDatabaseTarget(undefined)).toBeNull()
    expect(resolveDatabaseTarget('')).toBeNull()
    expect(resolveDatabaseTarget('not-a-url')).toBeNull()
    expect(resolveDatabaseTarget('postgresql://')).toBeNull()
  })
})

describe('the target it reports can never carry a credential', () => {
  it('reduces the connection string to host and database name', () => {
    const target = resolveDatabaseTarget(
      'postgresql://admin:hunter2@ep-abc-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require',
    )

    expect(target?.host).toBe('ep-abc-pooler.us-east-1.aws.neon.tech')
    expect(target?.database).toBe('neondb')
  })

  it('reports nothing that appears in the URL but not in host or database', () => {
    const url = 'postgresql://admin:hunter2@ep-abc.aws.neon.tech/neondb?sslmode=require&password=x'
    const target = resolveDatabaseTarget(url)

    // Serialising the whole report is the strongest form of the claim: if any
    // field carried a secret, this is where it would show.
    const reported = JSON.stringify(target)
    expect(reported).not.toContain('hunter2')
    expect(reported).not.toContain('admin')
    expect(reported).not.toContain('sslmode')
    expect(reported).not.toContain('postgresql://')
  })

  it('does not mistake a query-string password for the database name', () => {
    const target = resolveDatabaseTarget('postgresql://u:p@localhost/neondb?password=hunter2')
    expect(target?.database).toBe('neondb')
  })
})

describe('the confirmation names the exact number of rows about to go', () => {
  it('carries the count, so approving means reading the number', () => {
    expect(confirmationToken(0)).toBe('DELETE 0')
    expect(confirmationToken(1)).toBe('DELETE 1')
    expect(confirmationToken(4096)).toBe('DELETE 4096')
  })

  it('is plain ASCII, because the console this runs on is cp1252', () => {
    // A non-ASCII token cannot be typed reliably on a cp1252 console, which
    // would make the confirmation unanswerable rather than merely ugly.
    expect(/^[\x20-\x7e]+$/.test(confirmationToken(12345))).toBe(true)
  })
})

describe('the dry run is still the default', () => {
  it('only deletes on an explicit --apply, whatever the target is', async () => {
    const src = await Bun.file(
      new URL('../scripts/repair-attendance-duplicates.ts', import.meta.url).pathname.replace(
        /^\//,
        '',
      ),
    ).text()

    // The flag must still gate the delete, not merely the extra production
    // confirmation -- the dry-run default is the property both guards protect.
    expect(src).toContain("process.argv.includes('--apply')")
    expect(src).toContain("process.argv.includes('--allow-production')")
    // The delete is behind the confirmation, which is behind --apply.
    expect(src.indexOf('const confirmed = await confirm(token)')).toBeLessThan(
      src.indexOf('await prisma.$transaction(async (tx) =>'),
    )
    expect(src).toContain('Nothing was deleted.')
  })
})

describe('the guards fail closed by ordering, not just by existing', () => {
  it('refuses a production --apply before it queries the database', async () => {
    const src = await Bun.file(
      new URL('../scripts/repair-attendance-duplicates.ts', import.meta.url).pathname.replace(
        /^\//,
        '',
      ),
    ).text()

    // Order is the whole claim. A refusal placed after `buildPlan` still reads
    // every duplicate group out of the live database, which is an unauthorised
    // connection to production from a run the operator never authorised -- and
    // it is a refusal that cannot fire at all if that read fails first.
    expect(src).toContain('if (APPLY && target.isProduction && !ALLOW_PRODUCTION)')
    expect(src.indexOf('if (APPLY && target.isProduction && !ALLOW_PRODUCTION)')).toBeLessThan(
      src.indexOf('await buildPlan()'),
    )
  })

  it('reports the target it refused, so the refusal is actionable', async () => {
    const src = await Bun.file(
      new URL('../scripts/repair-attendance-duplicates.ts', import.meta.url).pathname.replace(
        /^\//,
        '',
      ),
    ).text()

    const guard = src.slice(
      src.indexOf('if (APPLY && target.isProduction && !ALLOW_PRODUCTION)'),
      src.indexOf('await buildPlan()'),
    )
    expect(guard).toContain('${target.host}')
    expect(guard).toContain('--allow-production')
    // It has to exit non-zero, or a CI step that only checks the exit code sees
    // the run as a success.
    expect(guard).toContain('process.exitCode = 1')
  })

  it('never runs main() on import', async () => {
    const src = await Bun.file(
      new URL('../scripts/repair-attendance-duplicates.ts', import.meta.url).pathname.replace(
        /^\//,
        '',
      ),
    ).text()

    // This file imported the script above, so an unconditional `main()` would
    // already have opened a connection by now.
    expect(src).toContain('if (import.meta.main)')
  })

  it('refuses to confirm without a terminal, before it reads a reply', async () => {
    const src = await Bun.file(
      new URL('../scripts/repair-attendance-duplicates.ts', import.meta.url).pathname.replace(
        /^\//,
        '',
      ),
    ).text()

    // Piped or redirected stdin reads as absent, so a prompt answered by a pipe
    // -- `echo DELETE 12 | bun run ... --apply` -- would otherwise delete without
    // a person having read the count. The refusal has to come before the read,
    // not after it, or it is answering a question it already asked.
    expect(src).toContain('if (!process.stdin.isTTY)')
    expect(src.indexOf('if (!process.stdin.isTTY)')).toBeLessThan(
      src.indexOf('const answer = (await rl.question('),
    )
    expect(src.indexOf('const answer = (await rl.question(')).toBeLessThan(
      src.indexOf('rl.close()'),
    )
  })

  it('compares the typed reply rather than accepting any input', async () => {
    const src = await Bun.file(
      new URL('../scripts/repair-attendance-duplicates.ts', import.meta.url).pathname.replace(
        /^\//,
        '',
      ),
    ).text()

    // `.trim() === expected` rather than a truthiness check: an empty answer, a
    // bare Enter, or `yes` must all fall through to "did not match". Both halves
    // are asserted because either alone is insufficient — trimming without the
    // comparison accepts anything, and the comparison without the trim rejects a
    // correct answer typed with a trailing space.
    expect(src).toContain('const answer = (await rl.question(')
    expect(src).toMatch(/\)\)\.trim\(\)\s*\n\s*return answer === expected/)
  })
})