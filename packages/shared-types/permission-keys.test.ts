import { describe, it, expect } from 'bun:test'
import {
  PERMISSION_CATALOG,
  PERMISSION_CATALOG_BY_KEY,
  PERMISSION_KEYS,
  PERMISSION_ACTIONS,
  PERMISSION_CATEGORIES,
  PLATFORM_ROLE_NAMES,
  ROLE_DEFAULT_SCOPE,
  ROLE_READ_SCOPE,
  parsePermissionKey,
  permissionMatches,
  permissionsForRole,
  scopeFor,
} from './permission-keys'
import { PermissionSchema } from './index'

const NOW = new Date('2026-01-01T00:00:00.000Z')

/** A minimal valid row for PermissionSchema, keyed by catalog entry. */
function row(key: string) {
  const def = PERMISSION_CATALOG_BY_KEY.get(key)
  if (!def) throw new Error(`${key} is not in the catalog`)
  return {
    id: 'clx0000000000000000000001',
    tenantId: 'clx0000000000000000000002',
    schoolId: null,
    createdAt: NOW,
    updatedAt: NOW,
    key,
    description: def.description,
    category: def.category,
    resource: def.resource,
    action: def.action,
    scope: def.scope,
    isSystem: true,
  }
}

describe('permission key grammar', () => {
  it('parses every key in the catalog', () => {
    for (const def of PERMISSION_CATALOG) {
      const parsed = parsePermissionKey(def.key)
      expect(parsed, `${def.key} failed to parse`).not.toBeNull()
      expect(parsed!.resource).toBe(def.resource)
      expect(parsed!.action).toBe(def.action)
    }
  })

  it('extracts the sub-resource of a three-segment key', () => {
    expect(parsePermissionKey('finance:invoice:create')).toEqual({
      resource: 'finance',
      subResource: 'invoice',
      action: 'create',
      isWildcard: false,
    })
    expect(parsePermissionKey('student:read')!.subResource).toBeNull()
  })

  it('rejects malformed keys', () => {
    for (const bad of ['', ':read', 'read:', 'a:b:c:d', 'Student:read', 'student:read!', 'a b:c']) {
      expect(parsePermissionKey(bad), `${bad} should be rejected`).toBeNull()
    }
  })

  it('treats a trailing wildcard segment as a wildcard', () => {
    expect(parsePermissionKey('academic:*')!.isWildcard).toBe(true)
    expect(parsePermissionKey('*')!.isWildcard).toBe(true)
  })

  it('has no duplicate keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length)
  })
})

describe('PermissionSchema', () => {
  it('accepts every catalog entry, including the three-segment and multi-word-verb keys the old regex rejected', () => {
    for (const key of PERMISSION_KEYS) {
      const result = PermissionSchema.safeParse(row(key))
      expect(result.success, `${key} rejected: ${JSON.stringify(result.error?.issues)}`).toBe(true)
    }
  })

  it('rejects a resource that disagrees with the key', () => {
    const result = PermissionSchema.safeParse({ ...row('student:read'), resource: 'teacher' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path[0] === 'resource')).toBe(true)
  })

  it('rejects an action that disagrees with the key', () => {
    const result = PermissionSchema.safeParse({ ...row('student:read'), action: 'delete' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((i) => i.path[0] === 'action')).toBe(true)
  })

  it('rejects a malformed key', () => {
    expect(PermissionSchema.safeParse({ ...row('student:read'), key: 'a:b:c:d' }).success).toBe(false)
  })
})

describe('wildcard matching', () => {
  it('matches an exact grant', () => {
    expect(permissionMatches('student:read', 'student:read')).toBe(true)
    expect(permissionMatches('student:read', 'student:write')).toBe(false)
  })

  it('honours a prefix wildcard, which a bare Set.has never did', () => {
    expect(permissionMatches('academic:*', 'academic:read')).toBe(true)
    expect(permissionMatches('academic:*', 'academic:delete')).toBe(true)
    expect(permissionMatches('academic:*', 'student:read')).toBe(false)
  })

  it('honours the global wildcard', () => {
    expect(permissionMatches('*', 'anything:at:all')).toBe(true)
  })

  it('does not treat a partial segment as a prefix', () => {
    expect(permissionMatches('academic:*', 'academics:read')).toBe(false)
  })
})

describe('role grants', () => {
  it('grants HEADMASTER every key', () => {
    expect(permissionsForRole('HEADMASTER').sort()).toEqual([...PERMISSION_KEYS].sort())
  })

  it('never grants a delete to ASSISTANT_HEAD', () => {
    expect(permissionsForRole('ASSISTANT_HEAD').some((k) => k.includes('delete'))).toBe(false)
  })

  it('never grants a system-category key outside HEADMASTER', () => {
    for (const role of PLATFORM_ROLE_NAMES.filter((r) => r !== 'HEADMASTER')) {
      const leaked = permissionsForRole(role).filter((k) => PERMISSION_CATALOG_BY_KEY.get(k)!.category === 'system')
      expect(leaked, `${role} must not hold system keys: ${leaked.join(', ')}`).toEqual([])
    }
  })

  it('never grants classroom teachers the school-wide configuration keys', () => {
    const granted = permissionsForRole('CLASSROOM_TEACHER')
    for (const forbidden of ['grading:update', 'promotion:execute', 'score:approve']) {
      expect(granted).not.toContain(forbidden)
    }
  })

  it('gives PARENT only self-scoped and school-wide-notice reads', () => {
    expect(permissionsForRole('PARENT').sort()).toEqual(
      [
        'announcement:read',
        'communication:read',
        'document:health:read',
        'document:health:upload',
        'report:read',
        'student:health:read',
        'student:health:write',
        'student:read',
      ].sort(),
    )
  })

  it('scopes every PARENT grant to their own child except school-wide notices', () => {
    // The set assertion above says which keys a parent holds. This says what
    // each one is allowed to reach, which is the part that actually protects a
    // child. `report:read` is what makes a parent able to open their own child's
    // report card; if it ever resolved to `all` the same key would hand a parent
    // every report in the school.
    const scopes = Object.fromEntries(
      permissionsForRole('PARENT').map((key) => [key, scopeFor('PARENT', key)]),
    )
    expect(scopes['report:read']).toBe('own')
    expect(scopes['student:read']).toBe('own')
    // Not student data: a notice and a school message genuinely are
    // school-wide, so these two are the deliberate exceptions.
    expect(scopes['announcement:read']).toBe('all')
    expect(scopes['communication:read']).toBe('all')
    // Anything else a parent is granted in future must not be school-wide by
    // accident. Adding a key to ROLE_GRANT_RULES.PARENT without a scope
    // override silently widens it, so the default is pinned here.
    const schoolWideByNature = new Set(['announcement:read', 'communication:read'])
    for (const [key, scope] of Object.entries(scopes)) {
      if (schoolWideByNature.has(key)) continue
      expect(scope, `PARENT grant ${key} must not be school-wide`).not.toBe('all')
    }
  })

  it('grants no unknown keys and every granted key exists in the catalog', () => {
    for (const role of PLATFORM_ROLE_NAMES) {
      for (const key of permissionsForRole(role)) {
        expect(PERMISSION_CATALOG_BY_KEY.has(key), `${role} grants unknown key ${key}`).toBe(true)
      }
    }
  })
})

describe('row-level scope fails closed', () => {
  it('resolves to "all" for a limited role only through an explicit override', () => {
    // The regression this guards: `scopeFor` used to fall back to the catalog
    // scope, which is `all` for every entry, so an unmapped key silently meant
    // "expose the whole school". School-wide notices genuinely must be `all`,
    // so the invariant is not "never all" -- it is that `all` is always a
    // recorded decision rather than a fallback.
    for (const role of ['PARENT', 'CLASSROOM_TEACHER'] as const) {
      expect(ROLE_DEFAULT_SCOPE[role], `${role} default must narrow`).not.toBe('all')
      for (const key of PERMISSION_KEYS) {
        if (scopeFor(role, key) !== 'all') continue
        expect(
          ROLE_READ_SCOPE[role]?.[key],
          `${role} + ${key} resolved to "all" with no explicit override`,
        ).toBe('all')
      }
    }
  })

  it('keeps every explicit "all" override on genuinely school-wide data', () => {
    // An `all` override is only defensible for something every member of the
    // school is entitled to. If a record-bearing key ever lands here, this
    // fails and forces a deliberate decision.
    const schoolWide = /^(communication|announcement|event):/
    for (const role of ['PARENT', 'CLASSROOM_TEACHER'] as const) {
      for (const [key, scope] of Object.entries(ROLE_READ_SCOPE[role] ?? {})) {
        if (scope !== 'all') continue
        expect(key, `${role} has a school-wide override for ${key}`).toMatch(schoolWide)
      }
    }
  })

  it('narrows a parent to their own children and attendance', () => {
    expect(scopeFor('PARENT', 'student:read')).toBe('own')
    expect(scopeFor('PARENT', 'enrollment:read')).toBe('own')
    // Inert today because the grant rules withhold the key, but the scope must
    // already be correct or granting it later would leak the whole register.
    expect(scopeFor('PARENT', 'attendance:read')).toBe('own')
  })

  it('still shows school-wide notices to a parent', () => {
    expect(scopeFor('PARENT', 'announcement:read')).toBe('all')
    expect(scopeFor('PARENT', 'communication:read')).toBe('all')
  })

  it('narrows a classroom teacher to their classes', () => {
    for (const key of ['student:read', 'attendance:read', 'attendance:mark', 'timetable:read', 'teacher:read']) {
      expect(scopeFor('CLASSROOM_TEACHER', key), key).toBe('class')
    }
  })

  it('still shows school-wide notices and events to a teacher', () => {
    for (const key of ['communication:read', 'communication:send', 'announcement:read', 'event:read']) {
      expect(scopeFor('CLASSROOM_TEACHER', key), key).toBe('all')
    }
  })

  it('leaves the school-wide roles unrestricted', () => {
    for (const role of ['HEADMASTER', 'ASSISTANT_HEAD', 'HEAD_TEACHER', 'ACCOUNTANT', 'ADMIN_STAFF'] as const) {
      expect(scopeFor(role, 'student:read'), role).toBe('all')
    }
  })

  it('denies everything when there is no role at all', () => {
    expect(scopeFor(null, 'student:read')).toBe('custom')
    expect(scopeFor(undefined, 'student:read')).toBe('custom')
    expect(scopeFor('', 'student:read')).toBe('custom')
  })

  it('keeps every scope override pointing at a key that exists', () => {
    for (const [role, map] of Object.entries(ROLE_READ_SCOPE)) {
      for (const key of Object.keys(map)) {
        expect(PERMISSION_CATALOG_BY_KEY.has(key), `${role} narrows unknown key ${key}`).toBe(true)
      }
    }
  })
})

describe('controlled vocabularies', () => {
  it('uses only declared actions and categories in the catalog', () => {
    for (const def of PERMISSION_CATALOG) {
      expect(PERMISSION_ACTIONS).toContain(def.action)
      expect(PERMISSION_CATEGORIES).toContain(def.category)
    }
  })

  it('grants every role a non-empty, non-total permission set', () => {
    for (const role of PLATFORM_ROLE_NAMES) {
      const granted = permissionsForRole(role)
      expect(granted.length, `${role} has no permissions`).toBeGreaterThan(0)
    }
  })

  it('keeps every role except the Head of School short of the whole catalog', () => {
    // The "non-total" half of the title above, which that test used to omit.
    // Rewriting `permissionsForRole` as `catalog.filter(() => true)` made every
    // role fully privileged — ROLE_GRANT_RULES bypassed and never read — and the
    // loop stayed green, because `length > 0` cannot tell a scoped grant from the
    // entire catalog.
    //
    // HEADMASTER is exempt on purpose, not by oversight: its rule is literally
    // `() => true` (permission-keys.ts), because the Head of School is the
    // school's principal and is meant to hold every permission the tenant defines.
    // The exemption is stated here rather than smuggled in, so that "HEADMASTER is
    // total" stays a visible decision instead of becoming the one role nobody
    // checks.
    const catalogSize = PERMISSION_CATALOG.length
    for (const role of PLATFORM_ROLE_NAMES) {
      if (role === 'HEADMASTER') continue
      const granted = permissionsForRole(role)
      expect(granted.length, `${role} was granted every permission in the catalog`).toBeLessThan(
        catalogSize,
      )
    }
  })

  it('gives the Head of School the whole catalog, deliberately', () => {
    // Pins the exemption above so it cannot quietly become a bug in either
    // direction: HEADMASTER losing a permission is as much a regression as another
    // role gaining one.
    expect(permissionsForRole('HEADMASTER').length).toBe(PERMISSION_CATALOG.length)
  })

  it('grants only permissions that exist in the catalog', () => {
    // The other half of "scoped": a grant set can be short without being correct if
    // it is short because it names things that do not exist.
    for (const role of PLATFORM_ROLE_NAMES) {
      for (const granted of permissionsForRole(role)) {
        expect(PERMISSION_CATALOG.map((def) => def.key)).toContain(granted)
      }
    }
  })
})

