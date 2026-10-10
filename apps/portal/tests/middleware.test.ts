import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PERMISSION_ACTIONS,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  PermissionSchema,
  PLATFORM_ROLE_NAMES,
  parsePermissionKey,
  permissionsForRole,
  scopeFor,
} from '@novastar/shared-types'
import {
  studentVisibilityWhere,
  visibilityDeniesAll,
  type Visibility,
} from '@/lib/visibility'
import {
  ROUTE_PERMISSION_BINDINGS,
  requiredPermissionForPath,
} from '@/lib/auth/permission-routes'

const PORTAL = join(import.meta.dir, '..')

function readRoute(...parts: string[]): string {
  return readFileSync(join(PORTAL, 'app/api', ...parts), 'utf-8')
}

function readLib(name: string): string {
  return readFileSync(join(PORTAL, 'lib', name), 'utf-8')
}

/**
 * Strip comments so a negative source assertion tests code, not prose.
 *
 * Several fixes here are explained in comments that necessarily name the thing
 * they removed — `getToken`, `'students_view'` — so asserting the raw source
 * would fail against an accurate explanation of the fix. String literals are
 * preserved so a `//` inside one (a URL, a path) is not mistaken for a comment.
 */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const ch = src[i] as string
    const next = src[i + 1]
    if (quote) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

/** Extract the body of an exported route handler function from source. */
function extractHandler(src: string, handlerName: string): string {
  const marker = `export async function ${handlerName}`
  const start = src.indexOf(marker)
  if (start === -1) return ''

  // Skip past the parameter list (which may contain nested braces) to find
  // the opening brace of the function body.
  let i = start + marker.length
  let parenDepth = 0
  let bodyStart = -1
  for (; i < src.length; i++) {
    const ch = src[i]
    if (ch === '(') parenDepth++
    else if (ch === ')') {
      parenDepth--
      if (parenDepth === 0) {
        // End of parameter list; find the '{' that starts the body
        while (i < src.length && src[i] !== '{' && src[i] !== '\n') i++
        while (i < src.length && src[i] !== '{') i++
        bodyStart = i
        break
      }
    }
  }
  if (bodyStart === -1) return ''

  // Count braces from the body opening brace
  let depth = 0
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') depth++
    if (src[j] === '}') {
      depth--
      if (depth === 0) return src.slice(start, j + 1)
    }
  }
  return src.slice(start)
}

describe('Middleware - Config Endpoint Protection', () => {
  const configRoute = readRoute('config/route.ts')
  const entitiesRoute = readRoute('config/[entityType]/route.ts')
  const entityIdRoute = readRoute('config/[entityType]/[id]/route.ts')
  const entitiesListRoute = readRoute('config/entities/route.ts')
  const entitiesTypeRoute = readRoute('config/entities/[type]/route.ts')

  describe('config/route.ts', () => {
    it('should use hasPermission with config:read for GET on base config endpoint', () => {
      const handler = extractHandler(configRoute, 'GET')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:read'")
    })

    it('should handle ForbiddenError in GET catch block', () => {
      const handler = extractHandler(configRoute, 'GET')
      expect(handler).toContain("'ForbiddenError'")
    })

    it('should handle UnauthorizedError in GET catch block', () => {
      const handler = extractHandler(configRoute, 'GET')
      expect(handler).toContain("'UnauthorizedError'")
    })

    it('should not leak ServerConfigError messages to client', () => {
      const handler = extractHandler(configRoute, 'GET')
      expect(handler).toContain('Internal server error')
      expect(handler).not.toContain('TENANT_ID not set')
      expect(handler).not.toContain('misconfigured')
    })
  })

  describe('config/[entityType]/route.ts', () => {
    it('should use hasPermission with config:read for GET', () => {
      const handler = extractHandler(entitiesRoute, 'GET')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:read'")
    })

    it('should use hasPermission with config:write for POST', () => {
      const handler = extractHandler(entitiesRoute, 'POST')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:write'")
    })

    it('should handle ForbiddenError in GET catch block', () => {
      const handler = extractHandler(entitiesRoute, 'GET')
      expect(handler).toContain("'ForbiddenError'")
    })

    it('should handle ForbiddenError in POST catch block', () => {
      const handler = extractHandler(entitiesRoute, 'POST')
      expect(handler).toContain("'ForbiddenError'")
    })
  })

  describe('config/[entityType]/[id]/route.ts', () => {
    it('should use hasPermission with config:read for GET', () => {
      const handler = extractHandler(entityIdRoute, 'GET')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:read'")
    })

    it('should use hasPermission with config:write for PATCH', () => {
      const handler = extractHandler(entityIdRoute, 'PATCH')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:write'")
    })

    it('should use hasPermission with config:write for DELETE', () => {
      const handler = extractHandler(entityIdRoute, 'DELETE')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:write'")
    })

    it('GET catch block should handle ForbiddenError', () => {
      const handler = extractHandler(entityIdRoute, 'GET')
      expect(handler).toContain("'ForbiddenError'")
    })

    it('PATCH catch block should handle ForbiddenError', () => {
      const handler = extractHandler(entityIdRoute, 'PATCH')
      expect(handler).toContain("'ForbiddenError'")
    })

    it('DELETE catch block should handle ForbiddenError', () => {
      const handler = extractHandler(entityIdRoute, 'DELETE')
      expect(handler).toContain("'ForbiddenError'")
    })
  })

  describe('config/entities/[type]/route.ts', () => {
    it('should use hasPermission with config:read for GET', () => {
      const handler = extractHandler(entitiesTypeRoute, 'GET')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:read'")
    })

    it('should use hasPermission with config:write for PATCH', () => {
      const handler = extractHandler(entitiesTypeRoute, 'PATCH')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:write'")
    })

    it('should use hasPermission with config:write for DELETE', () => {
      const handler = extractHandler(entitiesTypeRoute, 'DELETE')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:write'")
    })

    it('should handle ForbiddenError in GET catch block', () => {
      const handler = extractHandler(entitiesTypeRoute, 'GET')
      expect(handler).toContain("'ForbiddenError'")
    })

    it('should handle ForbiddenError in PATCH catch block', () => {
      const handler = extractHandler(entitiesTypeRoute, 'PATCH')
      expect(handler).toContain("'ForbiddenError'")
    })

    it('should handle ForbiddenError in DELETE catch block', () => {
      const handler = extractHandler(entitiesTypeRoute, 'DELETE')
      expect(handler).toContain("'ForbiddenError'")
    })
  })

  describe('config/entities/route.ts', () => {
    it('should use hasPermission with config:read for GET', () => {
      const handler = extractHandler(entitiesListRoute, 'GET')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain("'config:read'")
    })

    it('should filter overrides by tenantId', () => {
      const handler = extractHandler(entitiesListRoute, 'GET')
      expect(handler).toContain('tenantId')
    })

    it('should not fall back to defaults on error (no silent data swallow)', () => {
      const handler = extractHandler(entitiesListRoute, 'GET')
      expect(handler).not.toContain('DEFAULT_ENTITY_REGISTRY.map(e => ({ ...e, _isOverridden: false }))')
    })

    it('should handle UnauthorizedError in GET catch block', () => {
      const handler = extractHandler(entitiesListRoute, 'GET')
      expect(handler).toContain("'UnauthorizedError'")
    })

    it('should handle ServerConfigError in GET catch block', () => {
      const handler = extractHandler(entitiesListRoute, 'GET')
      expect(handler).toContain("'ServerConfigError'")
    })
  })
})

describe('Middleware - Finance Endpoint Protection', () => {
  const invoicesRoute = readRoute('finance/invoices/route.ts')
  const paymentsRoute = readRoute('finance/payments/route.ts')
  const invoicePaymentsRoute = readRoute('finance/invoices/[id]/payments/route.ts')
  const paymentMethodsRoute = readRoute('finance/payment-methods/route.ts')

  it('should use hasPermission with finance:invoice:create for POST invoices', () => {
    expect(invoicesRoute).toContain('hasPermission')
    expect(invoicesRoute).toContain('finance:invoice:create')
  })

  it('should use hasPermission with finance:read for GET invoices', () => {
    expect(invoicesRoute).toContain('hasPermission')
    expect(invoicesRoute).toContain('finance:read')
  })

  it('should use hasPermission with finance:payment:record for POST payments', () => {
    expect(paymentsRoute).toContain('hasPermission')
    expect(paymentsRoute).toContain('finance:payment:record')
  })

  it('should use hasPermission with finance:read for GET payments', () => {
    expect(paymentsRoute).toContain('hasPermission')
    expect(paymentsRoute).toContain('finance:read')
  })

  it('should use hasPermission with finance:read for GET invoice payments', () => {
    expect(invoicePaymentsRoute).toContain('hasPermission')
    expect(invoicePaymentsRoute).toContain('finance:read')
  })

  it('should use hasPermission with finance:payment for POST invoice payments', () => {
    expect(invoicePaymentsRoute).toContain('hasPermission')
    expect(invoicePaymentsRoute).toContain('finance:payment')
  })

  it('should use hasPermission with finance:read for GET payment-methods', () => {
    expect(paymentMethodsRoute).toContain('hasPermission')
    expect(paymentMethodsRoute).toContain('finance:read')
  })
})

describe('Middleware - Assessment Endpoint Protection', () => {
  const assessmentsRoute = readRoute('assessments/route.ts')
  const assessmentIdRoute = readRoute('assessments/[id]/route.ts')
  const scoresRoute = readRoute('assessments/[id]/scores/route.ts')

  it('should use hasPermission with assessment:create for POST assessments', () => {
    expect(assessmentsRoute).toContain('hasPermission')
    expect(assessmentsRoute).toContain('assessment:create')
  })

  it('should use hasPermission with assessment:read for GET assessments list', () => {
    expect(assessmentsRoute).toContain('hasPermission')
    expect(assessmentsRoute).toContain('assessment:read')
  })

  // GET-by-id and PATCH-by-id used to be asserted here with
  // `expect(assessmentIdRoute).toContain('assessment:read')` and `toContain(
  // 'assessment:update')`. Both were green while this route applied no row
  // scope whatsoever, which is the point: naming a permission in a handler's
  // source says nothing about whether the handler narrows rows. They are now
  // executed instead, in `tests/route-authz.test.ts`, against a class-scoped
  // principal — including the `assessment:publish` gate on `isPublished`.

  it('should use hasPermission with assessment:delete for DELETE assessment', () => {
    expect(assessmentIdRoute).toContain('hasPermission')
    expect(assessmentIdRoute).toContain('assessment:delete')
  })

  it('should use hasPermission with assessment:read for GET assessment scores', () => {
    expect(scoresRoute).toContain('hasPermission')
    expect(scoresRoute).toContain('assessment:read')
  })

  it('should use hasPermission with assessment:grade for POST scores', () => {
    expect(scoresRoute).toContain('hasPermission')
    expect(scoresRoute).toContain('assessment:grade')
  })
})

describe('Middleware - Rate Limiter', () => {
  const rateLimitSrc = readLib('rate-limit.ts')
  const authRoute = readFileSync(
    join(PORTAL, 'app/api/auth/[...nextauth]/route.ts'),
    'utf-8'
  )

  it('should export checkRateLimit function', () => {
    expect(rateLimitSrc).toContain('export function checkRateLimit')
  })

  it('should export clientIdentifier function', () => {
    expect(rateLimitSrc).toContain('export function clientIdentifier')
  })

  it('should export resetRateLimit function', () => {
    expect(rateLimitSrc).toContain('export function resetRateLimit')
  })

  it('should use in-memory Map for rate limiting storage', () => {
    expect(rateLimitSrc).toContain('Map')
  })

  it('should apply rate limiting in auth callback route', () => {
    expect(authRoute).toContain('checkRateLimit')
    expect(authRoute).toContain('CREDENTIALS_ATTEMPTS')
  })

  it('should return 429 with Retry-After header on rate limit', () => {
    expect(authRoute).toContain('status: 429')
    expect(authRoute).toContain('Retry-After')
  })

  it('should use TRUSTED_PROXY_HOPS for hop indexing (not first hop blindly)', () => {
    expect(rateLimitSrc).toContain('TRUSTED_PROXY_HOPS')
  })
})

/**
 * Every GET in this group is permission-gated *and* visibility-filtered.
 *
 * The two are separate questions and the codebase used to answer only the first:
 * `PARENT` holds `student:read`, so gating `GET /api/students` on that key alone
 * still returned the whole school roster. So the load-bearing assertion per
 * route is not "it mentions hasPermission" but "it mentions both gates".
 * `tests/route-authz.test.ts` covers the behaviour; these pin the wiring.
 */
describe('Middleware - Row-Level Visibility on GET', () => {
  it('should require both hasPermission and resolveVisibility on the students list', () => {
    const handler = extractHandler(readRoute('students/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'student:read'")
    expect(handler).toContain('resolveVisibility')
    expect(handler).toContain('studentVisibilityWhere')
    expect(handler).toContain('visibilityDeniesAll')
  })

  it('should scope the single-student lookup by visibility and answer 404 when out of scope', () => {
    const handler = extractHandler(readRoute('students/[id]/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'student:read'")
    expect(handler).toContain('studentVisibilityWhere')
    expect(handler).toContain('visibilityDeniesAll')
    // The filter belongs in the `where`, so an out-of-scope row is
    // indistinguishable from a row that does not exist.
    expect(handler).toContain('findFirst')
    expect(handler).toContain('studentVisibilityWhere(visibility)')
    expect(handler).toContain("{ status: 404 }")
  })

  it('should require both gates on the teachers list', () => {
    const handler = extractHandler(readRoute('teachers/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'teacher:read'")
    expect(handler).toContain('staffVisibilityWhere')
    expect(handler).toContain('visibilityDeniesAll')
  })

  // The single-teacher and single-class lookups used to be asserted here with
  // `expect(handler).toContain('staffVisibilityWhere')`. Both were green while
  // `teachers/[id]` spread that builder over the path `id` and handed back an
  // arbitrary colleague for any id at all: a presence check cannot see a
  // property that was overwritten three lines later. They are executed now, in
  // `tests/route-authz.test.ts`.

  it('should require both gates on the classes list', () => {
    const handler = extractHandler(readRoute('classes/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'class:read'")
    expect(handler).toContain('classVisibilityWhere')
    expect(handler).toContain('visibilityDeniesAll')
  })

  it('should gate the terms list with term:read', () => {
    const handler = extractHandler(readRoute('terms/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'term:read'")
    expect(handler).toContain('visibilityDeniesAll')
    // Terms are not narrowed per role, so no where-builder is expected here.
    expect(handler).not.toContain('VisibilityWhere')
  })

  it('should gate the enrollments list with enrollment:read and narrow by visibility', () => {
    const handler = extractHandler(readRoute('enrollments/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'enrollment:read'")
    expect(handler).toContain('enrollmentVisibilityWhere')
    expect(handler).toContain('visibilityDeniesAll')
  })

  it('should gate the announcements list with announcement:read', () => {
    const handler = extractHandler(readRoute('announcements/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'announcement:read'")
  })

  it('should gate the single announcement with announcement:read', () => {
    const handler = extractHandler(readRoute('announcements/[id]/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'announcement:read'")
  })

  it('should gate the events list with event:read', () => {
    const handler = extractHandler(readRoute('events/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'event:read'")
  })

  it('should gate the single event with event:read', () => {
    const handler = extractHandler(readRoute('events/[id]/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'event:read'")
  })

  it('should gate the library catalogue with library:read', () => {
    const handler = extractHandler(readRoute('library/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'library:read'")
  })

  it('should gate the single book with library:read', () => {
    const handler = extractHandler(readRoute('library/[id]/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'library:read'")
  })

  it('should gate library loans with library:loan:read and scope by school through a relation', () => {
    const handler = extractHandler(readRoute('library/loans/[id]/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'library:loan:read'")
    // `BookLoan` has no `schoolId` column, so school scope must arrive through
    // a relation. An unqualified `where: { tenantId }` here is the bug.
    expect(handler).toContain('schoolId')
    expect(handler).toContain('book: { schoolId }')
    expect(handler).not.toMatch(/const where[^=]*=\s*\{\s*tenantId\s*\}/)
  })

  it('should gate the inventory list with inventory:read', () => {
    const handler = extractHandler(readRoute('inventory/route.ts'), 'GET')
    expect(handler).toContain('hasPermission')
    expect(handler).toContain("'inventory:read'")
  })

  it('should keep tenantId and schoolId in every guarded students where', () => {
    const handler = extractHandler(readRoute('students/route.ts'), 'GET')
    expect(handler).toContain('schoolId')
    expect(handler).toContain('tenantId')
  })
})

describe('Middleware - Session self-read', () => {
  const sessionRoute = readRoute('session/route.ts')
  const sessionCode = stripComments(sessionRoute)

  it('should resolve the session through the database-backed context, not a bare token', () => {
    // `getToken` is JWT-only: it cannot see a suspension made after the token
    // was minted, and it has no database round trip to confirm the tenant.
    expect(sessionCode).toContain('getCachedSessionAndTenant')
    expect(sessionCode).not.toContain('getToken')
    expect(sessionCode).not.toContain('next-auth/jwt')
  })

  it('should scope the user read to the session tenant', () => {
    expect(sessionCode).toContain('where: { id: userId, tenantId }')
  })

  it('should select an explicit allow-list rather than serialising the whole row', () => {
    // A bare `include` would ship `twoFactorSecret`, `passkeyBridgeToken`,
    // `verifyToken` and `passwordHash` to the browser.
    expect(sessionCode).toContain('select: {')
    expect(sessionCode).not.toContain('include:')
    for (const secretField of [
      'twoFactorSecret',
      'passkeyBridgeToken',
      'verifyToken',
      'passwordHash',
    ]) {
      // Never selected, in the query or echoed into the response body.
      expect(sessionCode.includes(`${secretField}:`)).toBe(false)
      expect(sessionCode.includes(`${secretField},`)).toBe(false)
    }
  })

  it('should map a missing session to 401 rather than 500', () => {
    expect(sessionCode).toContain("'UnauthorizedError'")
    expect(sessionCode).toContain('{ status: 401 }')
  })
})

describe('Middleware - Unauthenticated credential write paths are closed', () => {
  const totpSetup = stripComments(readRoute('auth/totp/route.ts'))
  const totpVerify = stripComments(readRoute('auth/totp/verify/route.ts'))
  const registerOptions = stripComments(readRoute('auth/passkey/register-options/route.ts'))
  const registerVerify = stripComments(readRoute('auth/passkey/register-verify/route.ts'))
  const loginOptions = stripComments(readRoute('auth/passkey/login-options/route.ts'))
  const loginVerify = stripComments(readRoute('auth/passkey/login-verify/route.ts'))
  const proxySrc = stripComments(readFileSync(join(PORTAL, 'proxy.ts'), 'utf-8'))

  it('should require a session for TOTP enrolment', () => {
    expect(totpSetup).toContain('getCachedSessionAndTenant')
    expect(totpSetup).toContain('{ status: 401 }')
  })

  it('should derive the TOTP enrolment subject from the session, never the body', () => {
    const handler = extractHandler(totpSetup, 'POST')
    expect(handler).not.toContain('body.userId')
    expect(handler).not.toMatch(/const\s*\{\s*userId\s*\}\s*=\s*body/)
    expect(handler).toContain('where: { id: userId }')
  })

  it('should require a session for TOTP verification', () => {
    expect(totpVerify).toContain('getCachedSessionAndTenant')
    expect(totpVerify).toContain('{ status: 401 }')
  })

  it('should derive the TOTP verification subject from the session, never the body', () => {
    const handler = extractHandler(totpVerify, 'POST')
    expect(handler).not.toMatch(/const\s*\{\s*userId\s*,?\s*code\s*\}\s*=\s*body/)
    expect(handler).toContain('where: { id: userId }')
  })

  it('should require a session for passkey registration options', () => {
    expect(registerOptions).toContain('getCachedSessionAndTenant')
    expect(registerOptions).toContain('{ status: 401 }')
  })

  it('should select the registration subject by session id, not by a body email', () => {
    const handler = extractHandler(registerOptions, 'POST')
    expect(handler).not.toMatch(/const\s*\{\s*email\s*\}\s*=\s*body/)
    expect(handler).not.toContain('where: { email }')
    expect(handler).toContain('where: { id: userId, tenantId }')
  })

  it('should require a session for passkey registration verification', () => {
    expect(registerVerify).toContain('getCachedSessionAndTenant')
    expect(registerVerify).toContain('{ status: 401 }')
  })

  it('should enrol the passkey against the session user, never a body email', () => {
    const handler = extractHandler(registerVerify, 'POST')
    expect(handler).not.toMatch(/const\s*\{\s*credential\s*,\s*email\s*,\s*name\s*\}\s*=\s*body/)
    expect(handler).not.toContain('prisma.user.findFirst')
    expect(handler).toContain('userId,')
    expect(handler).toContain("storedChallenge.userId !== userId")
  })

  it('should keep passkey login pre-authenticated', () => {
    // By design: the WebAuthn signature is the credential. Adding a session
    // requirement here would make the login endpoint unreachable.
    expect(loginOptions).not.toContain('getCachedSessionAndTenant')
    expect(loginVerify).not.toContain('getCachedSessionAndTenant')
  })

  it('should rate limit both passkey login handlers in-handler', () => {
    // The proxy's publicPaths list exempted all of /api/auth/*, so these had no
    // limiter at all until the handlers carried their own.
    for (const src of [loginOptions, loginVerify]) {
      expect(src).toContain('checkRateLimit')
      expect(src).toContain('clientIdentifier')
      expect(src).toContain('PASSKEY_ATTEMPTS')
      expect(src).toContain('status: 429')
    }
  })

  it('should refuse every non-ACTIVE account status at passkey login', () => {
    expect(loginVerify).toContain('canPasskeyLogin')
    // A positive test against ACTIVE, so a status added to the enum later is
    // refused by default rather than silently admitted.
    expect(loginVerify).toContain("user.status === 'ACTIVE'")
    expect(loginVerify).toContain('user.isActive')
  })

  it('should rate limit /api/auth before the public-path short-circuit', () => {
    const limiter = proxySrc.indexOf('checkRateLimit')
    const publicShortCircuit = proxySrc.indexOf('publicPaths.some(')
    expect(limiter).toBeGreaterThan(-1)
    expect(publicShortCircuit).toBeGreaterThan(-1)
    // THE ordering bug: the short-circuit used to run first, which left
    // /api/auth/* unauthenticated AND unthrottled.
    expect(limiter).toBeLessThan(publicShortCircuit)
  })

  it('should give /api/auth its own tighter budget', () => {
    expect(proxySrc).toContain('AUTH_RATE_LIMIT')
    expect(proxySrc).toContain("pathname.startsWith('/api/auth')")
  })

  it('should drop the vestigial ADMIN_STAFF section that could never match', () => {
    // Section matching is `section === p || section.startsWith(p)` on the first
    // path segment, so 'students_view' never matched 'students'.
    expect(proxySrc).not.toContain("'students_view'")
  })
})

/**
 * The catalog is the single source of truth, so it is the thing that has to be
 * provably self-consistent. Every assertion here exists because the catalog was
 * once not: `PERMISSION_ACTIONS` omitted verbs the catalog itself needed, the
 * catalog shipped a key its own enum rejected, and the validator rejected every
 * live three-segment `Permission` row the previous seed had written.
 */
describe('Permission catalog integrity', () => {
  const actionSet = new Set<string>(PERMISSION_ACTIONS)

  it('should derive every catalog action from PERMISSION_ACTIONS, with no casts to hide a mismatch', () => {
    // THE guard against the `finance:payment` defect. `perm()` used to cast the
    // derived action to `PermissionAction`, which silenced the compiler on the
    // one row the enum rejected. It now narrows and throws at module load, and
    // this asserts the same invariant from the outside.
    const offenders = PERMISSION_CATALOG.filter((p) => !actionSet.has(p.action)).map((p) => `${p.key} -> ${p.action}`)
    expect(offenders).toEqual([])
  })

  it('should derive every catalog key and action from the key itself', () => {
    // A hand-written `resource`/`action` that disagrees with its own key would
    // make the seed write a row the validator rejects on the next read.
    const mismatched = PERMISSION_CATALOG.filter((p) => {
      const parsed = parsePermissionKey(p.key)
      return parsed === null || parsed.action !== p.action || parsed.resource !== p.resource
    }).map((p) => p.key)
    expect(mismatched).toEqual([])
  })

  it('should reject an action that is not in the enum rather than admitting it', () => {
    // The negative control. Without it, an enum that accepted everything would
    // also satisfy the two assertions above.
    expect(actionSet.has('notarealverb')).toBe(false)
    expect(parsePermissionKey('student:notarealverb')).not.toBeNull()
  })

  it('should hold finance:payment, which is a live key that the grammar makes derive `payment`', () => {
    // Renaming this to `finance:payment:pay` would orphan it in every live
    // Role.permissions array and open POST /api/finance/invoices/[id]/payments.
    expect(PERMISSION_KEYS).toContain('finance:payment')
    expect(actionSet.has('payment')).toBe(true)
  })

  it('should not carry student:read:own, which cannot be expressed by the grammar', () => {
    // `parsePermissionKey('student:read:own')` reports action `own`, which is not
    // a verb. ROLE_READ_SCOPE.PARENT['student:read'] = 'own' already delivers the
    // same constraint without a second key.
    expect(parsePermissionKey('student:read:own')?.action).toBe('own')
    expect(PERMISSION_KEYS).not.toContain('student:read:own')
  })
})

describe('PermissionSchema tolerates both live resource conventions', () => {
  const base = {
    id: 'clx0a1b2c3d4e5f6g7h8i9j0k',
    tenantId: 'clx0z9y8x7w6v5u4t3s2r1q0p',
    description: 'probe',
    category: 'finance' as const,
    scope: 'all' as const,
    isSystem: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }

  function row(key: string, resource: string) {
    return PermissionSchema.safeParse({ ...base, key, resource, action: parsePermissionKey(key)?.action })
  }

  // The four families the previous seed wrote as `resource:subResource`, and
  // that the current catalog writes as `resource`. Both are live rows.
  const THREE_SEGMENT = [
    'finance:invoice:create',
    'inventory:item:create',
    'library:book:create',
    'library:loan:create',
  ]

  it('should validate every three-segment key with the legacy `resource:subResource` spelling', () => {
    for (const key of THREE_SEGMENT) {
      const legacy = key.split(':').slice(0, 2).join(':')
      expect(`${key} as ${legacy}: ${row(key, legacy).success}`).toBe(`${key} as ${legacy}: true`)
    }
  })

  it('should validate every three-segment key with the catalog `resource` spelling', () => {
    for (const key of THREE_SEGMENT) {
      const current = key.split(':')[0] as string
      expect(`${key} as ${current}: ${row(key, current).success}`).toBe(`${key} as ${current}: true`)
    }
  })

  it('should still reject a resource that matches neither spelling', () => {
    // The relaxation must not have disabled the check. This is the assertion that
    // keeps the validator from becoming a no-op that accepts every row.
    const result = row('finance:invoice:create', 'library')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'resource')).toBe(true)
    }
  })

  it('should still reject an action that disagrees with the key', () => {
    const result = PermissionSchema.safeParse({
      ...base,
      key: 'finance:invoice:create',
      resource: 'finance',
      action: 'read',
    })
    expect(result.success).toBe(false)
  })
})

describe('Role grant matrices', () => {
  const NEW_KEYS = [
    'timetable:read',
    'timetable:update',
    'grading:read',
    'grading:update',
    'promotion:execute',
    'assessment:publish',
    'report:export',
  ] as const

  const grantsFor = (role: (typeof PLATFORM_ROLE_NAMES)[number]) =>
    new Set(permissionsForRole(role))

  it('should carry every new key in the catalog', () => {
    for (const key of NEW_KEYS) expect(PERMISSION_KEYS).toContain(key)
  })

  it('should not duplicate class:read or attendance:read', () => {
    expect(PERMISSION_KEYS.filter((k) => k === 'class:read')).toHaveLength(1)
    expect(PERMISSION_KEYS.filter((k) => k === 'attendance:read')).toHaveLength(1)
  })

  it('should not grant a parent any timetable write, grading write or promotion', () => {
    const parent = grantsFor('PARENT')
    for (const key of ['timetable:update', 'grading:update', 'promotion:execute'] as const) {
      expect(`${key}: ${parent.has(key)}`).toBe(`${key}: false`)
    }
  })

  it('should not grant a parent any key beyond their own children and communications', () => {
    expect(permissionsForRole('PARENT').sort()).toEqual([
      'announcement:read',
      'communication:read',
      'document:health:read',
      'document:health:upload',
      'report:read',
      'student:health:read',
      'student:health:write',
      'student:read',
    ])
  })

  it('should grant the headmaster every catalog key', () => {
    expect(permissionsForRole('HEADMASTER')).toHaveLength(PERMISSION_CATALOG.length)
  })

  it('should narrow a classroom teacher away from grading writes and promotion', () => {
    // The grant rule hands that role the whole academic category minus `delete`.
    // That is right for grading and publishing assessments and wrong for
    // rewriting the grading policy or promoting a cohort, so those two are
    // excluded explicitly.
    const teacher = grantsFor('CLASSROOM_TEACHER')
    expect(teacher.has('grading:read')).toBe(true)
    expect(teacher.has('assessment:publish')).toBe(true)
    expect(`${teacher.has('grading:update')}`).toBe('false')
    expect(`${teacher.has('promotion:execute')}`).toBe('false')
  })

  it('should grant no delete verb to a classroom teacher, admin staff or a parent', () => {
    // Deliberately not asserted for the other three roles, whose rules are the
    // pre-existing seed behaviour and carry deletes:
    //   HEADMASTER   — everything, by design.
    //   ACCOUNTANT   — `finance:delete`, `finance:invoice:delete` via its
    //                  `category === 'finance'` rule. Deleting a financial
    //                  record is plausibly an auditor's question, not this
    //                  change's to answer.
    //   HEAD_TEACHER — `academic|student|communication` with no delete filter.
    // Worth a decision; not silently changed here.
    for (const role of ['CLASSROOM_TEACHER', 'ADMIN_STAFF', 'PARENT', 'ASSISTANT_HEAD'] as const) {
      expect(`${role}: ${permissionsForRole(role).some((k) => k.includes('delete'))}`).toBe(
        `${role}: false`,
      )
    }
  })

  it('should resolve timetable:read to a class for a classroom teacher', () => {
    expect(scopeFor('CLASSROOM_TEACHER', 'timetable:read')).toBe('class')
    expect(scopeFor('HEADMASTER', 'timetable:read')).toBe('all')
  })

  it('should narrow the staff directory for a classroom teacher', () => {
    // `staffVisibilityWhere` narrows on a `class` scope. Nothing resolved to
    // `class` for this key before, so the builder was unreachable and the
    // directory was returned in full.
    expect(scopeFor('CLASSROOM_TEACHER', 'teacher:read')).toBe('class')
  })
})

describe('Route-permission table and the catalog cannot drift apart', () => {
  it('should name only keys the catalog actually ships', () => {
    // The table used to define a second, dot-cased vocabulary — `payments.approve`,
    // `users.manage` and twelve more — that nothing granted. Every
    // `hasPermission(userId, <dot key>)` lookup through it could never succeed.
    const catalog = new Set<string>(PERMISSION_KEYS)
    const unknown = ROUTE_PERMISSION_BINDINGS.map((b) => b.permission).filter((p) => !catalog.has(p))
    expect(unknown).toEqual([])
  })

  it('should hold only catalog keys after prefix lookup, for every binding', () => {
    const catalog = new Set<string>(PERMISSION_KEYS)
    for (const binding of ROUTE_PERMISSION_BINDINGS) {
      const concrete = binding.prefix.replace(/\[[^/\]]+\]/g, 'real-id')
      const found = requiredPermissionForPath(concrete)
      expect(found?.permission).toBe(binding.permission)
      expect(catalog.has(found?.permission ?? '')).toBe(true)
    }
  })

it('should carry no dot-cased key anywhere in the module source', () => {
    // The regression guard for the deleted vocabulary: a permission literal in
    // this file must use the catalog's colon grammar. Comments are stripped, so
    // the table's own "was `payments.approve`" notes do not trip it.
    const src = stripComments(readLib('auth/permission-routes.ts'))
    const dotKeys = [...src.matchAll(/'([a-z]+(?:\.[a-z]+)+)'/g)].map((m) => m[1])
    expect(dotKeys).toEqual([])
  })

  it('should match a binding that carries a dynamic path segment', () => {
    // `[id]` used to be stripped along with the slashes around it, so no
    // pathname could ever match this binding.
    expect(requiredPermissionForPath('/api/staff/users/usr_123/role')?.permission).toBe(
      'system:manage',
    )
    expect(requiredPermissionForPath('/api/staff/users/usr_123')).toBeNull()
  })

  it('should ignore a query string when matching', () => {
    expect(requiredPermissionForPath('/api/staff/payments?page=2')?.permission).toBe(
      'finance:approve',
    )
  })
})

/**
 * The headline regression: a parent holds `student:read`, so a permission gate
 * alone cannot keep them out of the school roster. `resolveVisibility` resolves
 * `ROLE_READ_SCOPE.PARENT['student:read'] = 'own'`, and the `where` builder turns
 * that into a filter Prisma applies — so the row cannot come back at all.
 *
 * `resolveVisibility` itself is exercised against a mocked client in
 * `tests/route-authz.test.ts`; the builders and the scope resolution are pure, so
 * the whole filter is provable here without a database.
 */
describe('A parent reading GET /api/students sees only their own children', () => {
  const PARENT_ID = 'clxparent0000000000000001'
  const OTHER_PARENT_ID = 'clxparent0000000000000002'

  const ROSTER = [
    { id: 'stu-1', studentId: 'NMS-0001', lastName: 'Owusu', parentId: PARENT_ID },
    { id: 'stu-2', studentId: 'NMS-0002', lastName: 'Mensah', parentId: PARENT_ID },
    { id: 'stu-3', studentId: 'NMS-0003', lastName: 'Adjei', parentId: OTHER_PARENT_ID },
  ]

  /** Apply a `where` the way a real client would, so the assertions are behavioural. */
  function query(
    where: Record<string, unknown>,
    rows: typeof ROSTER = ROSTER,
  ): typeof ROSTER {
    return rows.filter((row) => {
      if (typeof where.parentId === 'string' && row.parentId !== where.parentId) return false
      return true
    })
  }

  /** The visibility a PARENT resolves to for `student:read`, before any lookup. */
  function parentVisibility(): Visibility {
    return {
      scope: scopeFor('PARENT', 'student:read'),
      classIds: [],
      parentId: PARENT_ID,
      staffId: null,
    }
  }

  it('should resolve student:read for a parent to the `own` scope', () => {
    expect(scopeFor('PARENT', 'student:read')).toBe('own')
    expect(scopeFor('HEADMASTER', 'student:read')).toBe('all')
  })

  it('should turn that scope into a parentId filter in the where clause', () => {
    expect(studentVisibilityWhere(parentVisibility())).toEqual({ parentId: PARENT_ID })
  })

  it('should return two children and never the third family\'s student', () => {
    const where = studentVisibilityWhere(parentVisibility())
    const rows = query(where as Record<string, unknown>)
    expect(rows.map((r) => r.id)).toEqual(['stu-1', 'stu-2'])
    // The specific leak: NMS-0003 belongs to another parent.
    expect(rows.some((r) => r.id === 'stu-3')).toBe(false)
  })

  it('should send no filter for an unrestricted role, so the narrowing is not unconditional', () => {
    const headmaster: Visibility = { scope: 'all', classIds: null, parentId: null, staffId: null }
    const where = studentVisibilityWhere(headmaster) as Record<string, unknown>
    expect(where).toEqual({})
    expect(query(where)).toHaveLength(3)
  })

  it('should answer forbidden, not an empty list, when the caller has no Parent row', () => {
    // `visibilityDeniesAll` exists so a broken identity link is not
    // indistinguishable from "you have no children".
    const broken: Visibility = { scope: 'own', classIds: [], parentId: null, staffId: null }
    expect(visibilityDeniesAll(broken)).toBe(true)
    // And the filter it would produce matches nothing rather than everything.
    expect(query(studentVisibilityWhere(broken) as Record<string, unknown>)).toHaveLength(0)
  })

  it('should scope a classroom teacher by class enrollment rather than by parent', () => {
    const teacher: Visibility = {
      scope: scopeFor('CLASSROOM_TEACHER', 'student:read'),
      classIds: ['cls-basic1a'],
      parentId: null,
      staffId: 'clxstaff00000000000000001',
    }
    expect(teacher.scope).toBe('class')
    const where = studentVisibilityWhere(teacher) as Record<string, unknown>
    expect(where.parentId).toBeUndefined()
    expect(JSON.stringify(where)).toContain('cls-basic1a')
  })
})

/**
 * A source-text presence check, not coverage.
 *
 * These assert that a handler's text mentions `hasPermission`, the right key and
 * (where narrowed) the visibility plumbing. That is worth something — it catches a
 * gate deleted outright — but it passes just as happily against a gate that is
 * present and never reached, and it cannot see the one thing that matters: whether
 * the id the caller asked for survives into the `where`.
 *
 * `classes/[id]`, `teachers/[id]` and `assessments/[id]` were listed here and
 * their entries removed once `tests/route-authz.test.ts` executed those three
 * handlers against a class-scoped principal and asserted 200-for-in-scope /
 * 404-for-out-of-scope / 404-for-wrong-but-in-scope. A presence check standing in
 * for that is worse than no test, because it reads as coverage. The remaining
 * routes still need the same conversion; it needs prisma doubles for models this
 * file does not mock.
 */
describe('Every guarded GET handler declares its read permission', () => {
  /**
   * The read key each route must carry, and whether the route also resolves a
   * row-level scope.
   *
   * `narrowed: false` means the resource is school-wide and not row-scoped —
   * the permission gate is still required, but asserting `resolveVisibility`
   * there would be asserting a change nobody asked for.
   */
  const READ_GUARDS: [route: string, key: string, builder: string | null][] = [
    ['classes/route.ts', 'class:read', 'classVisibilityWhere'],
    ['students/route.ts', 'student:read', 'studentVisibilityWhere'],
    ['students/[id]/route.ts', 'student:read', 'studentVisibilityWhere'],
    ['teachers/route.ts', 'teacher:read', 'staffVisibilityWhere'],
    ['announcements/route.ts', 'announcement:read', null],
    ['announcements/[id]/route.ts', 'announcement:read', null],
    ['terms/route.ts', 'term:read', null],
    ['events/route.ts', 'event:read', null],
    ['library/route.ts', 'library:read', null],
    ['inventory/route.ts', 'inventory:read', null],
    ['enrollments/route.ts', 'enrollment:read', 'enrollmentVisibilityWhere'],
  ]

  for (const [route, key, builder] of READ_GUARDS) {
    it(`should gate GET ${route} on ${key}`, () => {
      const handler = extractHandler(readRoute(route), 'GET')
      expect(handler).not.toBe('')
      expect(handler).toContain('hasPermission')
      expect(handler).toContain(`'${key}'`)
      if (builder) {
        // A permission gate alone does not say which rows the caller may read.
        expect(handler).toContain('resolveVisibility')
        expect(handler).toContain('visibilityDeniesAll')
        expect(handler).toContain(builder)
      }
    })
  }

  it('should refuse a caller with no school before querying anything', () => {
    // Every one of these handlers starts the same way. A missing schoolId would
    // otherwise produce a query with no school column and read across schools.
    for (const [route] of READ_GUARDS) {
      const handler = extractHandler(readRoute(route), 'GET')
      expect(`${route}: ${handler.includes("'No school assigned'")}`).toBe(
        `${route}: true`,
      )
    }
  })
})

describe('Config entity routes report duplicates as 409, not 500', () => {
  const entitiesRoute = readRoute('config/[entityType]/route.ts')
  const entityIdRoute = readRoute('config/[entityType]/[id]/route.ts')
  // The detection used to be copy-pasted into each of six routes. It now lives
  // in one module, so these assertions have to follow the definition there: a
  // route that quietly stopped importing the helper would still satisfy a
  // `toContain('isUniqueConstraintViolation')` on its own source.
  const conflictSrc = readLib('prisma-conflict.ts')

  it('should detect P2002 in the one place that decides what counts as a duplicate', () => {
    // Matched on `name` as well as `code`, and both are required: `instanceof`
    // fails across a duplicated `@prisma/client`, and a bare `code` check would
    // catch any unrelated error that happens to carry one.
    expect(conflictSrc).toContain("'P2002'")
    expect(conflictSrc).toContain('PrismaClientKnownRequestError')
  })

  it('should build the 409 response once, with a message a client can act on', () => {
    expect(conflictSrc).toContain('status: 409')
    expect(conflictSrc).toContain('already exists')
  })

  it('should route both config handlers through that shared helper', () => {
    for (const src of [entitiesRoute, entityIdRoute]) {
      expect(src).toContain("from '@/lib/prisma-conflict'")
      expect(src).toContain('duplicateResponse')
    }
  })

  it('should not have kept its own copy of the detection', () => {
    // A second definition is the original defect: two of them drift, and one of
    // them ends up in a route that forgot to update it.
    for (const src of [entitiesRoute, entityIdRoute]) {
      expect(src).not.toContain("'P2002'")
    }
  })

  it('should check for the duplicate before the generic 500 on POST', () => {
    const handler = extractHandler(entitiesRoute, 'POST')
    expect(handler).toContain('isUniqueConstraintViolation')
    expect(handler.indexOf('isUniqueConstraintViolation')).toBeLessThan(
      handler.indexOf("'Failed to create entity'"),
    )
  })

  it('should check for the duplicate before the generic 500 on PATCH', () => {
    const handler = extractHandler(entityIdRoute, 'PATCH')
    expect(handler).toContain('isUniqueConstraintViolation')
    expect(handler.indexOf('isUniqueConstraintViolation')).toBeLessThan(
      handler.indexOf("'Failed to update entity'"),
    )
  })

  it('should still map P2025-style misses to 404 rather than swallowing them', () => {
    // The 409 must not have displaced the existing not-found handling.
    for (const src of [entitiesRoute, entityIdRoute]) {
      expect(src).toContain('{ status: 404 }')
    }
  })
})

describe('attendance_taker is registered as a manageable entity', () => {
  const schemaSrc = readFileSync(
    join(PORTAL, '..', '..', 'packages/shared-types/config-schema.ts'),
    'utf-8',
  )

  it('should have a registry entry, not only a type', () => {
    // `EntityTypeSchema` listed `attendance_taker` from the start, so the admin
    // UI could reference an entity with no definition object behind it.
    expect(schemaSrc).toContain("'attendance_taker',")
    const registryStart = schemaSrc.indexOf('export const DEFAULT_ENTITY_REGISTRY')
    const entry = schemaSrc.indexOf("type: 'attendance_taker'")
    expect(entry).toBeGreaterThan(registryStart)
  })

  it('should expose the AttendanceTaker columns as form fields', () => {
    const entry = schemaSrc.slice(
      schemaSrc.indexOf("type: 'attendance_taker'"),
      schemaSrc.indexOf("type: 'attendance_taker'") + 1400,
    )
    for (const field of [
      'schoolId',
      'classId',
      'staffId',
      'canMarkStudent',
      'canMarkStaff',
      'isActive',
    ]) {
      expect(entry).toContain(`key: '${field}'`)
    }
  })

  it('should leave classId optional, because a null classId is a school-wide grant', () => {
    const entry = schemaSrc.slice(
      schemaSrc.indexOf("type: 'attendance_taker'"),
      schemaSrc.indexOf("type: 'attendance_taker'") + 1400,
    )
    const classIdLine = entry.split('\n').find((l) => l.includes("key: 'classId'")) ?? ''
    expect(classIdLine).not.toContain('required: true')
  })
})
