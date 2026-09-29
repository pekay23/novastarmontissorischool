import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORTAL = join(import.meta.dir, '..')

function readRoute(...parts: string[]): string {
  return readFileSync(join(PORTAL, 'app/api', ...parts), 'utf-8')
}

function readLib(name: string): string {
  return readFileSync(join(PORTAL, 'lib', name), 'utf-8')
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
  const entitiesTypeRoute = readRoute('config/entities/[type]/route.ts')

  describe('config/route.ts', () => {
    it('should require config:read for GET on base config endpoint', () => {
      const handler = extractHandler(configRoute, 'GET')
      expect(handler).toContain("requirePermission('config:read')")
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
    it('should require config:read for GET', () => {
      const handler = extractHandler(entitiesRoute, 'GET')
      expect(handler).toContain("requirePermission('config:read')")
    })

    it('should require config:write for POST', () => {
      const handler = extractHandler(entitiesRoute, 'POST')
      expect(handler).toContain("requirePermission('config:write')")
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
    it('should require config:read for GET', () => {
      const handler = extractHandler(entityIdRoute, 'GET')
      expect(handler).toContain("requirePermission('config:read')")
    })

    it('should require config:write for PATCH', () => {
      const handler = extractHandler(entityIdRoute, 'PATCH')
      expect(handler).toContain("requirePermission('config:write')")
    })

    it('should require config:write for DELETE', () => {
      const handler = extractHandler(entityIdRoute, 'DELETE')
      expect(handler).toContain("requirePermission('config:write')")
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
    it('should require config:read for GET', () => {
      const handler = extractHandler(entitiesTypeRoute, 'GET')
      expect(handler).toContain("requirePermission('config:read')")
    })

    it('should require config:write for PATCH', () => {
      const handler = extractHandler(entitiesTypeRoute, 'PATCH')
      expect(handler).toContain("requirePermission('config:write')")
    })

    it('should require config:write for DELETE', () => {
      const handler = extractHandler(entitiesTypeRoute, 'DELETE')
      expect(handler).toContain("requirePermission('config:write')")
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
})

describe('Middleware - Finance Endpoint Protection', () => {
  const invoicesRoute = readRoute('finance/invoices/route.ts')
  const paymentsRoute = readRoute('finance/payments/route.ts')
  const invoicePaymentsRoute = readRoute('finance/invoices/[id]/payments/route.ts')
  const paymentMethodsRoute = readRoute('finance/payment-methods/route.ts')

  it('should require finance:invoice:create for POST invoices', () => {
    expect(invoicesRoute).toContain("requirePermission('finance:invoice:create')")
  })

  it('should require finance:read for GET invoices', () => {
    expect(invoicesRoute).toContain("requirePermission('finance:read')")
  })

  it('should require finance:payment:record for POST payments', () => {
    expect(paymentsRoute).toContain("requirePermission('finance:payment:record')")
  })

  it('should require finance:read for GET payments', () => {
    expect(paymentsRoute).toContain("requirePermission('finance:read')")
  })

  it('should require finance:read for GET invoice payments', () => {
    expect(invoicePaymentsRoute).toContain("requirePermission('finance:read')")
  })

  it('should require finance:payment for POST invoice payments', () => {
    expect(invoicePaymentsRoute).toContain("requirePermission('finance:payment')")
  })

  it('should require finance:read for GET payment-methods', () => {
    expect(paymentMethodsRoute).toContain("requirePermission('finance:read')")
  })
})

describe('Middleware - Assessment Endpoint Protection', () => {
  const assessmentsRoute = readRoute('assessments/route.ts')
  const assessmentIdRoute = readRoute('assessments/[id]/route.ts')
  const scoresRoute = readRoute('assessments/[id]/scores/route.ts')

  it('should require assessment:create for POST assessments', () => {
    expect(assessmentsRoute).toContain("requirePermission('assessment:create')")
  })

  it('should require assessment:read for GET assessments list', () => {
    expect(assessmentsRoute).toContain("requirePermission('assessment:read')")
  })

  it('should require assessment:read for GET assessment by id', () => {
    expect(assessmentIdRoute).toContain("requirePermission('assessment:read')")
  })

  it('should require assessment:update for PATCH assessment', () => {
    expect(assessmentIdRoute).toContain("requirePermission('assessment:update')")
  })

  it('should require assessment:delete for DELETE assessment', () => {
    expect(assessmentIdRoute).toContain("requirePermission('assessment:delete')")
  })

  it('should require assessment:read for GET assessment scores', () => {
    expect(scoresRoute).toContain("requirePermission('assessment:read')")
  })

  it('should require assessment:grade for POST scores', () => {
    expect(scoresRoute).toContain("requirePermission('assessment:grade')")
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

  it('should use last hop of x-forwarded-for (not first)', () => {
    expect(rateLimitSrc).toContain('hops[hops.length - 1]')
  })
})
