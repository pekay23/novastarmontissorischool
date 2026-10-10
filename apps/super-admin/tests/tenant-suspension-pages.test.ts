// `./harness` first, always: it registers the `@/lib/prisma` and
// `@novastar/database` mocks, and every page below reaches the database. See the
// harness docstring and `bunfig.toml`, which preloads the harness so the mock
// cannot lose the race.
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  fakeOperator,
  givenLiveOperator,
  mocks,
  operatorClaims,
  resetHarness,
  setCookies,
} from './harness'
import { ADMIN_SESSION_COOKIE, createSessionToken } from '@/lib/admin-auth'

/**
 * The four tenant drill-down pages refuse a suspended tenant BEFORE reading anything.
 *
 * WHY THIS FILE IS NOT A SOURCE-GREP
 * ---------------------------------
 * `tests/tenant-suspension.test.ts` pins the gates: `requireTenantScope` throws, every
 * scoped query throws, every drill-down route answers 403. None of that reaches the
 * four pages, because the pages are the one surface that is *supposed* to render
 * rather than refuse — `/tenants/:tenantId` hosts the only "Reactivate tenant" button,
 * and gating it would put the control behind the gate it exists to open. Those four
 * answer the suspension question themselves, and for a long time the answer was a
 * convention: `if (!tenant.isActive) return <TenantSuspendedNotice />` on each page,
 * with nothing but review between a new drill-down page and a tenant's full directory.
 *
 * There is no DOM or server-render harness in this repo, and the obvious workaround —
 * read `if (!tenant.isActive)` out of the file and assert it is present — proves
 * nothing about ordering. A page that reads the tenant's schools on line 40 and
 * refuses on line 41 still contains the branch. Such a test is worse than no test,
 * because it reports coverage while being unable to fail.
 *
 * So this file runs the pages instead of reading them. A server component in this
 * codebase is an ordinary `async` function returning a React element, so calling it
 * and inspecting what comes back needs no renderer at all. That makes the property
 * that matters directly observable: for a suspended tenant, the page returns
 * `TenantSuspendedNotice` and *no model mock was called*.
 *
 * WHAT THIS PROVES, PRECISELY
 * ---------------------------
 * Proves, by execution:
 *   - each of the four refuses a suspended tenant, and the value it returns really is
 *     the notice component rather than `null`, a fragment or an error;
 *   - the notice receives only the tenant's id and code — no `settings`, no `name`, no
 *     counts, so the suspended path has no tenant payload to leak;
 *   - not one tenant-scoped read ran on the way there, which is the assertion that a
 *     source check cannot make: read-before-check fails here because the read throws
 *     or because the mock's call count is non-zero, and both fail loudly;
 *   - each of the four still renders normally for an active tenant and does perform
 *     its reads, so none of the above can be satisfied by a page that refuses
 *     everything.
 *
 * Does NOT prove:
 *   - anything about how the notice renders. `TenantSuspendedNotice` returns an
 *     element tree, not markup; `renderToStaticMarkup` on it throws
 *     `invariant expected app router to be mounted` because it contains a `next/link`,
 *     so "the operator sees 'This tenant is suspended'" is not asserted here and is
 *     not asserted anywhere else in this repo. The component is a pure function of
 *     three props and is pinned by reading, not by rendering;
 *   - that no *fifth* page forgot the branch. Nothing does for that; `ResolvedTenant`
 *     does, at compile time, and `tests/type-guards` below is the runtime half.
 *
 * The negative control matters as much as the refusal: without the active-tenant
 * block, "every page returns the notice and reads nothing" would pass for four pages
 * that render nothing at all.
 */

const PLATFORM_SESSION_SECRET = 'a-test-secret-that-is-long-enough-to-pass-32'
const TENANT_ID = 'tenant-page-refusal-alpha'
const OTHER_TENANT_ID = 'tenant-page-refusal-beta'

const { requireExistingTenant } = await import('@/lib/admin-context')
const { TenantSuspendedNotice } = await import('@/components/tenant-suspended-notice')
const DETAIL_PAGE = await import('@/app/(dashboard)/tenants/[tenantId]/page')
const SCHOOLS_PAGE = await import('@/app/(dashboard)/tenants/[tenantId]/schools/page')
const USERS_PAGE = await import('@/app/(dashboard)/tenants/[tenantId]/users/page')
const SETTINGS_PAGE = await import('@/app/(dashboard)/tenants/[tenantId]/settings/page')

/** The tenant as the drill-down pages read it, switched off. */
const SUSPENDED_ROW = {
  id: TENANT_ID,
  name: 'Alpha Montessori',
  code: 'alpha',
  domain: null,
  isActive: false,
  settings: { currency: 'GHS', timezone: 'Africa/Accra' },
  createdAt: new Date('2026-01-02T08:00:00.000Z'),
  updatedAt: new Date('2026-01-02T08:00:00.000Z'),
  _count: { schools: 3, users: 41 },
}

/** The same tenant, switched on. Only `isActive` differs. */
const ACTIVE_ROW = { ...SUSPENDED_ROW, isActive: true }

/** Anything one of these pages could conceivably read about a tenant. */
const TENANT_SCOPED_READS = {
  schoolFindMany: mocks.schoolFindMany,
  schoolFindFirst: mocks.schoolFindFirst,
  schoolCount: mocks.schoolCount,
  userFindMany: mocks.userFindMany,
  userFindFirst: mocks.userFindFirst,
  userCount: mocks.userCount,
  roleFindFirst: mocks.roleFindFirst,
  auditFindMany: mocks.auditFindMany,
  auditFindFirst: mocks.auditFindFirst,
  auditCount: mocks.auditCount,
} as const

/**
 * Which tenant-scoped reads ran, by name.
 *
 * Names rather than a count, so the failure says *what* leaked. A bare `toBe(0)`
 * across eleven mocks reports "expected 0, received 1" and leaves the reader guessing;
 * this reports `schoolFindMany` and, on the same failure, that the page read the
 * suspended tenant's schools before refusing.
 */
function scopedReads(): string[] {
  return Object.entries(TENANT_SCOPED_READS)
    .filter(([, mock]) => mock.mock.calls.length > 0)
    .map(([name, mock]) => `${name}x${mock.mock.calls.length}`)
    .sort()
}

interface PageUnderTest {
  readonly route: string
  readonly render: () => Promise<unknown>
  /**
   * Model mocks this page reads for an *active* tenant.
   *
   * Per page rather than a blanket "something was read", because the settings page
   * genuinely reads nothing beyond the tenant row: its document is already in
   * `tenant.settings`, so a control demanding a scoped read of it would be wrong. The
   * settings page's control is therefore the component assertion below, not this.
   */
  readonly activeReads: readonly string[]
  /**
   * Components this page can only reach after the suspension branch has been answered.
   *
   * The half of the negative control that works for all four pages: an active tenant
   * must put the real page on screen, so the returned tree has to contain a component
   * the refusal path does not render. Walked rather than rendered, for the reason at
   * the top of this file.
   */
  readonly activeComponents: readonly string[]
}

/** Every component named in an element tree, including the root. */
function componentNames(node: unknown, seen = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const child of node) componentNames(child, seen)
    return seen
  }
  if (!node || typeof node !== 'object') return seen
  const element = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof element.type === 'function') {
    seen.add((element.type as { name?: string }).name || 'anonymous')
  }
  if (element.props && 'children' in element.props) {
    componentNames(element.props.children, seen)
  }
  return seen
}

/**
 * The four drill-down pages, each invoked the way Next invokes it.
 *
 * A server component's props are promises in this codebase's Next version, so each
 * `render` hands over already-resolved `params`/`searchParams`. Building the argument
 * here rather than restating it per test keeps a change to the page's prop shape to
 * one edit.
 */
const PAGES: readonly PageUnderTest[] = [
  {
    route: '/tenants/:tenantId',
    render: () => DETAIL_PAGE.default({ params: Promise.resolve({ tenantId: TENANT_ID }) }),
    activeReads: ['schoolFindMany', 'auditFindMany', 'auditCount'],
    activeComponents: ['TenantActions', 'AuditLogTable'],
  },
  {
    route: '/tenants/:tenantId/schools',
    render: () => SCHOOLS_PAGE.default({ params: Promise.resolve({ tenantId: TENANT_ID }) }),
    activeReads: ['schoolFindMany'],
    activeComponents: ['SchoolList'],
  },
  {
    route: '/tenants/:tenantId/users',
    render: () =>
      USERS_PAGE.default({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        searchParams: Promise.resolve({}),
      }),
    activeReads: ['userFindMany', 'schoolFindMany'],
    activeComponents: ['CreateUserForm'],
  },
  {
    route: '/tenants/:tenantId/settings',
    render: () => SETTINGS_PAGE.default({ params: Promise.resolve({ tenantId: TENANT_ID }) }),
    activeReads: [],
    activeComponents: ['SettingsEditor'],
  },
]

/** Arms the tenant row. Answers on `where.id`, so a read of another tenant still misses. */
function givenTenant(row: typeof ACTIVE_ROW): void {
  mocks.tenantFindFirst.mockImplementation(async (args) =>
    args.where?.id === row.id ? row : null,
  )
}

/** A signed-in operator holding every capability, so no page is stopped by its own gate. */
function signIn(): void {
  const operator = fakeOperator()
  givenLiveOperator(operator)
  setCookies({ [ADMIN_SESSION_COOKIE]: createSessionToken(operatorClaims(operator)) })
}

/**
 * Asserts the element a page handed back is the suspension notice, and nothing else.
 *
 * The prop-key assertion is the security-relevant half. The notice needs the tenant's
 * id and code — the roster already showed both to the operator — so those are the only
 * props a suspended path is allowed to carry. A page that threaded `tenant` through to
 * the notice would render identically here and would still be holding a suspended
 * tenant's settings, name and user count inside a component boundary.
 */
function expectSuspensionNotice(returned: unknown, page: PageUnderTest): void {
  const element = returned as { type?: unknown; props?: Record<string, unknown> } | null

  // Not `toBeTruthy`: a page that returned `null`, `undefined` or a bare fragment
  // would pass a truthiness check while showing the operator nothing at all.
  if (!element || typeof element !== 'object') {
    throw new Error(
      `${page.route} returned ${String(returned)} for a suspended tenant instead of a React element. ` +
        'A suspended tenant must render TenantSuspendedNotice.',
    )
  }
  if (element.type !== TenantSuspendedNotice) {
    const rendered = typeof element.type === 'function' ? element.type.name : String(element.type)
    throw new Error(
      `${page.route} rendered ${rendered} for a suspended tenant instead of TenantSuspendedNotice. ` +
        'A suspended tenant must render the notice, not its data.',
    )
  }
  expect(Object.keys(element.props ?? {}).sort()).toEqual(['canUpdate', 'tenantCode', 'tenantId'])
  expect(element.props?.tenantId).toBe(TENANT_ID)
  expect(element.props?.tenantCode).toBe(SUSPENDED_ROW.code)
}

/**
 * Runs a page and names the route if it throws instead of refusing.
 *
 * Without this, a page that reads a suspended tenant's data before checking throws a
 * bare `TypeError` or `TenantSuspendedError` from three frames down, and the test
 * report says nothing about which page refused wrongly. The wrapped message says the
 * page a suspended tenant reached, which is the thing a reader needs.
 */
async function renderOrRefuse(page: PageUnderTest): Promise<unknown> {
  try {
    return await page.render()
  } catch (error) {
    throw new Error(
      `${page.route} threw for a SUSPENDED tenant instead of rendering TenantSuspendedNotice: ` +
        `${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    )
  }
}

beforeEach(() => {
  resetHarness()
  process.env.PLATFORM_SESSION_SECRET = PLATFORM_SESSION_SECRET
  process.env.NEXTAUTH_URL = 'https://portal.example.test'
  setCookies({})
  signIn()
})

describe('each drill-down page refuses a suspended tenant before reading anything', () => {
  for (const page of PAGES) {
    it(`should answer the notice and read nothing on ${page.route}`, async () => {
      givenTenant(SUSPENDED_ROW)

      const returned = await renderOrRefuse(page)

      expectSuspensionNotice(returned, page)
      // The assertion that a source check cannot make. Ordered *after* the render so a
      // page that reads first and throws reports the throw, which names the read.
      expect(scopedReads()).toEqual([])
    })

    it(`should still render the real page on ${page.route} when the tenant is active`, async () => {
      // The negative control. Without it, "every page returns the notice and reads
      // nothing" is satisfied by four pages that render nothing ever.
      givenTenant(ACTIVE_ROW)

      const returned = await page.render()
      const element = returned as { type?: unknown } | null

      expect(element?.type).not.toBe(TenantSuspendedNotice)
      expect(element).toBeTruthy()
      // The real page has to be on screen, not merely "something that is not the
      // notice" — so the tree has to contain a component the refusal path never
      // renders.
      const names = componentNames(returned)
      for (const component of page.activeComponents) {
        expect([...names].includes(component)).toBe(true)
      }
      // And the reads it is supposed to make, so a page that stopped reading at all
      // fails here instead of looking like a page that renders an empty list.
      expect(scopedReads()).toEqual(page.activeReads.map((name) => `${name}x1`).sort())
    })

    it(`should read the suspended tenant on ${page.route} at most once, and only the row`, async () => {
      // The resolver is the only tenant read on the refusal path, and it reads it
      // once. A page that re-read the tenant after the branch would be reading a row
      // it had already refused.
      givenTenant(SUSPENDED_ROW)

      await renderOrRefuse(page)

      expect(mocks.tenantFindFirst).toHaveBeenCalledTimes(1)
      expect(scopedReads()).toEqual([])
    })
  }
})

describe('the refusal names only the tenant the URL named', () => {
  it('should not read another tenant to produce the notice', async () => {
    // Two tenants, one suspended. The page asked about the suspended one; the notice
    // may say which, and must not have cost a read of anything else.
    mocks.tenantFindFirst.mockImplementation(async (args) => {
      if (args.where?.id === TENANT_ID) return SUSPENDED_ROW
      if (args.where?.id === OTHER_TENANT_ID) {
        return { ...ACTIVE_ROW, id: OTHER_TENANT_ID, name: 'Beta Montessori', code: 'beta' }
      }
      return null
    })

    const element = (await SCHOOLS_PAGE.default({
      params: Promise.resolve({ tenantId: TENANT_ID }),
    })) as { props: Record<string, unknown> }

    expect(Object.values(element.props)).not.toContain('Beta Montessori')
    expect(JSON.stringify(element.props)).not.toContain(SUSPENDED_ROW.settings.timezone)
    expect(scopedReads()).toEqual([])
  })
})

describe('requireExistingTenant hands a suspended tenant no payload to pass along', () => {
  it('should carry identity only, so no page can read the row before it refuses', async () => {
    // The runtime half of the type-level guarantee. `ResolvedTenant` puts `tenant` on
    // the active arm alone, which is what makes `const { tenant } = await
    // requireExistingTenant(id)` a compile error — the variant with `tenant` on BOTH
    // arms compiles clean and reintroduces the convention.
    givenTenant(SUSPENDED_ROW)

    const resolved = await requireExistingTenant(TENANT_ID)

    expect(Object.keys(resolved).sort()).toEqual(['identity', 'status'])
    expect('tenant' in resolved).toBe(false)
    expect(JSON.stringify(resolved)).not.toContain(SUSPENDED_ROW.name)
    expect(JSON.stringify(resolved)).not.toContain(SUSPENDED_ROW.settings.timezone)
  })

  it('should carry the row on the active arm', async () => {
    // The other direction. A resolver that answered only the suspended shape would
    // satisfy every refusal above while breaking all four pages in production.
    givenTenant(ACTIVE_ROW)

    const resolved = await requireExistingTenant(TENANT_ID)

    expect(resolved.status).toBe('active')
    if (resolved.status !== 'active') throw new Error('expected the active arm')
    expect(resolved.tenant.id).toBe(TENANT_ID)
    expect(Object.keys(resolved).sort()).toEqual(['status', 'tenant'])
  })
})