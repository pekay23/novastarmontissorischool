/**
 * The visible copy of the suspended-tenant notice.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 * -------------------------------
 * `tenant-suspension-pages.test.ts` proves each drill-down page RENDERS this
 * component and performs no tenant-scoped read before it does. That is the
 * security property. This file pins the component's own output, because the
 * page-level test says nothing about what an operator is actually told.
 *
 * That matters more than usual here. The copy makes two promises — that nothing
 * was deleted and that the tenant can be reactivated — and hosts the console's
 * only "Reactivate tenant" control. An operator who suspended a school twenty
 * minutes ago and clicked back into it is reading this text as the only
 * explanation available.
 *
 * HOW IT RENDERS WITHOUT A HARNESS
 * -------------------------------
 * `apps/super-admin` has no DOM or server-render harness and no testing-library
 * dependency, so `renderToStaticMarkup` is not available. `TenantSuspendedNotice`
 * is a plain function component with no hooks, so calling it returns its element
 * tree directly, and the tree can be walked structurally. That is the same
 * approach `tenant-suspension-pages.test.ts` uses for the pages, for the same
 * reason.
 *
 * WHAT THIS DOES NOT PROVE: nothing about CSS, layout, or how the prose reads to
 * a screen reader. It pins the text and the props, not the presentation.
 */
import { describe, expect, it } from 'bun:test'
import { TenantSuspendedNotice } from '@/components/tenant-suspended-notice'

type Node = {
  type?: unknown
  props?: Record<string, unknown>
}

function isElement(node: unknown): node is Node {
  return typeof node === 'object' && node !== null && 'type' in (node as object)
}

/** Every element in the tree, depth-first, in document order. */
function walk(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (!isElement(node)) return out
  out.push(node)
  walk(node.props?.children, out)
  return out
}

/**
 * The display name React would show for an element's type.
 *
 * `next/link` and friends are `React.forwardRef` results, so their `type` is an
 * object carrying `render`, not a function. Reading `.name` off it yields
 * "[object Object]" and the element goes unfound, so unwrap that case too.
 */
function typeName(node: Node): string {
  const t = node.type
  if (typeof t === 'string') return t
  if (typeof t === 'function') return (t as { displayName?: string; name: string }).displayName ?? t.name
  if (typeof t === 'object' && t !== null) {
    const exotic = t as { displayName?: string; render?: { displayName?: string; name?: string } }
    if (exotic.displayName) return exotic.displayName
    if (exotic.render) return exotic.render.displayName ?? exotic.render.name ?? 'forwardRef'
  }
  return String(t)
}

/** Every text run in the tree, joined, so a paragraph can be asserted as prose. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (isElement(node)) return textOf(node.props?.children)
  return String(node)
}

const TENANT_ID = 'tenant-suspension-alpha'
const TENANT_CODE = 'alpha'

function render(overrides: Partial<{ tenantId: string; tenantCode: string; canUpdate: boolean }> = {}) {
  const props = { tenantId: TENANT_ID, tenantCode: TENANT_CODE, canUpdate: true, ...overrides }
  const tree = TenantSuspendedNotice(props)
  return { tree, nodes: walk(tree), props }
}

describe('TenantSuspendedNotice', () => {
  it('names the reason in a heading, not only in the body prose', () => {
    const { nodes } = render()
    const heading = nodes.find((n) => n.type === 'h1')
    expect(heading).toBeDefined()
    expect(textOf(heading)).toBe('This tenant is suspended')
  })

  /**
   * The reassurance is the whole point of showing a notice instead of a 403. An
   * operator who cannot tell whether suspending a school deleted its data is an
   * operator who will not suspend anything.
   */
  it('says plainly that nothing was deleted', () => {
    const { nodes } = render()
    const body = nodes.find((n) => n.type === 'p')
    expect(body).toBeDefined()
    const prose = textOf(body)
    expect(prose).toContain('Nothing was deleted')
    expect(prose).toContain('every row is still there')
  })

  it('shows the tenant code it was given', () => {
    const { nodes } = render({ tenantCode: 'st-marys' })
    const code = nodes.find((n) => n.type === 'code')
    expect(code).toBeDefined()
    expect(textOf(code)).toBe('st-marys')
  })

  it('offers a way back to the roster', () => {
    const { nodes } = render()
    // Identified by `href`, not by the component's name. `next/link` is a
    // forwardRef object whose introspectable name is an implementation detail of
    // the library; the destination is the part this test actually cares about.
    const link = nodes.find((n) => typeof n.props?.href === 'string')
    expect(link).toBeDefined()
    expect(link!.props?.href).toBe('/tenants')
    expect(textOf(link)).toContain('Back to tenants')
  })

  /**
   * Load-bearing for recovery. `TenantActions` renders its control from
   * `isActive`, so `true` here would render "Suspend" on a tenant that is already
   * suspended — and since `setTenantActive` is deliberately ungated, that page
   * is the only route back from the console's drill-down views.
   */
  it('hands the actions component a suspended tenant, so the control reads Reactivate', () => {
    const { nodes } = render()
    const actions = nodes.find((n) => typeName(n) === 'TenantActions')
    expect(actions).toBeDefined()
    expect(actions!.props?.isActive).toBe(false)
    expect(actions!.props?.tenantId).toBe(TENANT_ID)
    expect(actions!.props?.tenantCode).toBe(TENANT_CODE)
  })

  it('passes the operator capability through rather than deriving it', () => {
    expect(render({ canUpdate: true }).nodes.find((n) => typeName(n) === 'TenantActions')!.props?.canUpdate).toBe(true)
    expect(render({ canUpdate: false }).nodes.find((n) => typeName(n) === 'TenantActions')!.props?.canUpdate).toBe(false)
  })

  /**
   * The page-level test proves no tenant-scoped READ happens. This proves the
   * notice itself carries none either: it is handed the code and id the roster
   * already shows, and nothing that came out of the tenant's own tables.
   */
  it('carries only the code and id, never a tenant detail', () => {
    const { nodes } = render()
    const actions = nodes.find((n) => typeName(n) === 'TenantActions')!
    expect(Object.keys(actions.props ?? {}).sort()).toEqual(['canUpdate', 'isActive', 'tenantCode', 'tenantId'])
  })

  it('does not leak a school, user count, or audit summary', () => {
    const { nodes } = render()
    const whole = textOf({ props: { children: nodes.map((n) => n.props?.children) } } as Node)
    for (const forbidden of ['school', ' pupils', 'users', 'audit entries']) {
      expect(whole.toLowerCase()).not.toContain(forbidden)
    }
  })
})