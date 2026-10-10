/**
 * The console's navigation.
 *
 * Declared as data rather than assembled inside each layout so the shell and the
 * pages cannot disagree about what exists. Each entry carries the capability it
 * needs, which means a link to a page the operator cannot open is filtered out
 * rather than rendered and then 403'd — a nav item that always fails is worse
 * than no nav item, because it teaches the operator the console is broken.
 *
 * `href` is a template string, not a `Route` type. The tenant routes are dynamic
 * and `typedRoutes` is not enabled in `next.config.ts`, so the literal type
 * `next/link` accepts would force a cast on every `href`.
 */

import type { OperatorCapability } from '@/lib/permissions'

export interface NavItem {
  readonly href: string
  readonly label: string
  readonly description: string
  readonly capability: OperatorCapability
}

export const PLATFORM_NAV: readonly NavItem[] = [
  {
    href: '/',
    label: 'Overview',
    description: 'Tenant, school and user totals for the whole platform.',
    capability: 'platform:read',
  },
  {
    href: '/tenants',
    label: 'Tenants',
    description: 'Every tenant on the platform, and drill-down into one.',
    capability: 'tenant:read',
  },
  {
    href: '/health',
    label: 'Health',
    description: 'Migration status, mirror reachability and audit volume.',
    capability: 'platform:read',
  },
  {
    href: '/audit',
    label: 'Audit',
    description: 'The cross-tenant audit trail.',
    capability: 'platform:audit',
  },
]

/** The drill-down tabs shown once an operator is inside one tenant. */
export const TENANT_NAV: readonly NavItem[] = [
  {
    href: '/tenants',
    label: 'Back to tenants',
    description: 'Leave this tenant.',
    capability: 'tenant:read',
  },
]

export function tenantTabs(tenantId: string): readonly NavItem[] {
  return [
    {
      href: `/tenants/${tenantId}`,
      label: 'Overview',
      description: 'This tenant in full.',
      capability: 'tenant:read',
    },
    {
      href: `/tenants/${tenantId}/schools`,
      label: 'Schools',
      description: 'Schools belonging to this tenant.',
      capability: 'tenant:read',
    },
    {
      href: `/tenants/${tenantId}/users`,
      label: 'Users',
      description: 'User directory for this tenant.',
      capability: 'tenant:user:read',
    },
    {
      href: `/tenants/${tenantId}/settings`,
      label: 'Settings',
      description: 'Mutable tenant fields and the settings document.',
      capability: 'tenant:config',
    },
  ]
}

export function visibleNav(
  items: readonly NavItem[],
  granted: readonly string[],
  isAllowed: (granted: readonly string[], capability: OperatorCapability) => boolean,
): readonly NavItem[] {
  return items.filter((item) => isAllowed(granted, item.capability))
}
