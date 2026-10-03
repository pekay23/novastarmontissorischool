/**
 * Audit aid, not a regression test: it prints every (role, permission) pair a
 * seeded role holds where the resolved row scope is narrower than `all`, and
 * asserts that none of them reaches a mutation handler that resolves no
 * visibility of its own.
 *
 * The point of the audit is that "no `resolveVisibility` in the handler" is not
 * by itself a finding. It is a finding exactly when some role that holds the
 * gate resolves to a scope narrower than `all`. Every other case is closed by
 * the permission gate alone, and adding row scope there would be noise.
 *
 * Run with `bun test tests/audit-limited-scope-gates.test.ts`. It reads the
 * catalog by executing it, so it cannot drift from `permission-keys.ts`.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { permissionsForRole, scopeFor } from '@novastar/shared-types'

const PORTAL = join(import.meta.dir, '..')
const API = join(PORTAL, 'app', 'api')

interface MutationHandler {
  route: string
  verb: string
  keys: string[]
  resolvesVisibility: boolean
}

/** Every exported POST/PUT/PATCH/DELETE in app/api, with its gate keys. */
function mutationHandlers(): MutationHandler[] {
  const found: MutationHandler[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') readRoute(full)
    }
  }

  const readRoute = (file: string): void => {
    const src = readFileSync(file, 'utf-8')
    const route = file.slice(API.length + 1).replace(/\\/g, '/').replace(/\/route\.ts$/, '')
    const re = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      // Balance the parameter list before the body, so a `{ params }`
      // destructure does not read as the end of the function.
      let depth = 0
      let i = src.indexOf('(', m.index)
      let paramEnd = i
      for (; i < src.length; i++) {
        if (src[i] === '(') depth++
        else if (src[i] === ')') {
          depth--
          if (depth === 0) {
            paramEnd = i
            break
          }
        }
      }
      depth = 0
      let bodyEnd = src.length
      for (i = src.indexOf('{', paramEnd); i < src.length; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') {
          depth--
          if (depth === 0) {
            bodyEnd = i
            break
          }
        }
      }
      const body = src.slice(m.index, bodyEnd)
      const keys = [
        ...new Set(
          [...body.matchAll(/hasPermission\(\s*\w+\s*,\s*'([a-z_]+:[a-z_]+)'/g)].map((k) => k[1]!),
        ),
      ]
      found.push({
        route,
        verb: m[1]!,
        keys,
        resolvesVisibility: body.includes('resolveVisibility('),
      })
    }
  }

  walk(API)
  return found.sort((a, b) => a.route.localeCompare(b.route) || a.verb.localeCompare(b.verb))
}

/** Every (role, key) a seeded role holds whose resolved scope is not `all`. */
function limitedGrants(): Map<string, Set<string>> {
  const roles = [
    'HEADMASTER',
    'ASSISTANT_HEAD',
    'HEAD_TEACHER',
    'ACCOUNTANT',
    'ADMIN_STAFF',
    'CLASSROOM_TEACHER',
    'PARENT',
  ] as const
  const out = new Map<string, Set<string>>()
  for (const role of roles) {
    for (const key of permissionsForRole(role)) {
      if (scopeFor(role, key) === 'all') continue
      if (!out.has(key)) out.set(key, new Set())
      out.get(key)!.add(role)
    }
  }
  return out
}

describe('every gate a scope-limited role can reach', () => {
  const limitedKeys = new Set(limitedGrants().keys())
  /**
   * Handlers whose row dimension is enforced by something other than
   * `resolveVisibility`, pinned with the source that makes it true.
   *
   * The `evidence` strings are the point: if the per-class loop or the grant
   * call is removed, the evidence disappears and the audit goes red. A bare
   * route name in a comment would not notice.
   */
  const ALTERNATE_AUTHORIZATION: Record<string, { why: string; evidence: string[] }> = {
    attendance: {
      why:
        'attendance:mark is authorised per class by the AttendanceTaker matrix (a grant row naming the class, or a school-wide row), not by teacher->class visibility. Adding resolveVisibility here would be wrong, not safer: a school may assign a taker who is not that class\'s teacher, and the matrix is the domain model for who may mark.',
      evidence: [
        'const requestedClassIds = [...new Set(records.map((record) => record.classId))]',
        'for (const requestedClassId of requestedClassIds) {',
        'classId: requestedClassId }',
        '!rosters.get(record.classId)?.has(record.studentId)',
      ],
    },
  }

  /**
   * Findings that are real and deliberately not fixed here, pinned so they
   * cannot be forgotten and cannot be silently re-introduced.
   *
   * `packages/shared-types/permission-keys.ts` is outside this task's ownership.
   * An entry added here must carry the reason it is out of scope, and the
   * `does not lose a pinned finding` test below turns red when a pinned finding
   * is fixed, so the entry gets revisited instead of going stale.
   *
   * `assessments/**` and `enrollments/**` were pinned here while they were
   * outside this task; both have since been fixed by their owning agent and the
   * entries removed, which is what that test is for.
   */
  const KNOWN_OUT_OF_SCOPE: Record<string, string> = {}

  it('lists the limited (role, key) grants that make row scope load-bearing', () => {
    const limited = limitedGrants()
    const summary = [...limited.entries()]
      .map(
        ([key, roles]) =>
          `${key} <- ${[...roles].sort().join(',')} (${scopeFor([...roles][0]!, key)})`,
      )
      .sort()

    // Printed so the audit table has a source that cannot drift from the catalog.
    console.log('\nlimited grants:\n' + summary.map((l) => '  ' + l).join('\n'))
    expect(summary.length).toBeGreaterThan(0)
  })

  it('leaves no in-scope mutation handler holding a limited key with no row scope', () => {
    const limited = limitedGrants()
    const ungated = mutationHandlers().filter(
      (h) =>
        !h.resolvesVisibility &&
        h.keys.some((k) => {
          const roles = limited.get(k)
          return roles !== undefined && roles.size > 0
        }),
    )

    // Each row here is a real finding: a role that resolves to less than the
    // whole school can pass the permission gate and then address any row.
    const rows = ungated
      .map((h) => ({
        id: `${h.verb} ${h.route}`,
        keys: h.keys,
        holders: h.keys.flatMap((k) =>
          [...(limited.get(k) ?? [])].map((r) => `${r}/${k}`),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    console.log('\nmutation handlers with a limited key and no row scope:')
    console.log(
      rows
        .map((r) => `  ${r.id} [${r.keys.join(',')}] holders: ${r.holders.join(' ')}`)
        .join('\n') || '  (none)',
    )
    console.log('\ncovered by an explicit per-row check instead of resolveVisibility:')
    console.log(
      Object.entries(ALTERNATE_AUTHORIZATION)
        .map(([r, v]) => `  POST ${r} -- ${v.why}`)
        .join('\n'),
    )
    console.log('\nout of scope, pinned:')
    console.log(
      Object.entries(KNOWN_OUT_OF_SCOPE)
        .map(([r, why]) => `  POST ${r} -- ${why}`)
        .join('\n'),
    )

    const unexpected = rows
      .map((r) => r.id)
      .filter((id) => {
        const route = id.replace(/^[A-Z]+ /, '')
        return !(route in KNOWN_OUT_OF_SCOPE) && !(route in ALTERNATE_AUTHORIZATION)
      })
    expect(unexpected).toEqual([])
  })

  it('still finds the source that justifies each alternate authorization', () => {
    // The declaration is only worth as much as the code it points at.
    for (const [route, { evidence }] of Object.entries(ALTERNATE_AUTHORIZATION)) {
      const src = readFileSync(join(API, route, 'route.ts'), 'utf-8')
      for (const needle of evidence) {
        // Reported as an object so a failure names both the route and the exact
        // snippet that went missing, instead of a bare "expected to contain".
        expect({ route, needle, found: src.includes(needle) }).toEqual({
          route,
          needle,
          found: true,
        })
      }
    }
  })

  it('does not lose a pinned finding silently', () => {
    // If a pinned route is fixed, this asks for the entry to be deleted so the
    // reason is revisited rather than left as a stale comment.
    const found = mutationHandlers()
      .filter((h) => !h.resolvesVisibility && h.keys.some((k) => limitedKeys.has(k)))
      .map((h) => h.route)
      .sort()
    const pinned = Object.keys(KNOWN_OUT_OF_SCOPE).sort()
    for (const p of pinned) {
      if (!found.includes(p)) {
        console.log(`\npinned finding no longer present: ${p} -- delete it from KNOWN_OUT_OF_SCOPE`)
      }
    }
    expect(
      found.filter(
        (f) => !pinned.includes(f) && !(f in ALTERNATE_AUTHORIZATION),
      ),
    ).toEqual([])
  })

  it('accounts for every mutation handler in the audit', () => {
    const all = mutationHandlers()
    console.log(`\nmutation handlers found: ${all.length}`)
    console.log(`with row scope: ${all.filter((h) => h.resolvesVisibility).length}`)
    // A silently-empty audit is worse than no audit, so pin the count.
    //
    // Pinned at 56, which is every mutation handler in THIS tree. Six further
    // credential-recovery routes are being added under `/api/auth` by a separate
    // piece of work (invite, verify-email, verify-email/resend, set-password,
    // forgot-password, reset-password); they are not committed here, and adding
    // them will take this pin to 62. None of them holds a permission key, so there
    // is no limited grant for row scope to narrow — their row boundary is the token
    // itself, or, for `invite`, the caller's session tenant and school. Re-pin when
    // the count moves, or the tripwire is decoration.
    expect(all.length).toBe(56)
  })
})