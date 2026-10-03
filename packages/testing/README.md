# @novastar/testing

Shared test utilities for the Novastar monorepo. Exports two independent entry points:

- **`@novastar/testing`** — `bun:test` side: factories, pure helpers, MSW server setup
- **`@novastar/testing/e2e`** — Playwright side: page objects, storage state helpers

## Runner Separation

This package contains **no test files** (Rule 1). It is a library consumed by tests, not a suite.

| Consumer | Imports From |
|----------|--------------|
| `bun test` unit/integration (`*.test.ts`) | `@novastar/testing` |
| Playwright spec (`*.spec.ts`, under `e2e/`) | `@novastar/testing/e2e` |

**Never** import `@playwright/test` from the `bun:test` side.
**Never** import `bun:test` from the Playwright side.

The `eslint.config.mjs` in this package enforces this with `no-restricted-imports` rules.

## Factories

Deterministic builders for tenant-scoped fixtures. Every factory takes a partial `overrides` argument and returns a complete, valid object matching the Prisma schema.

```ts
import { buildTenant, buildSchool, buildUser, buildStaff } from '@novastar/testing/factories'

const tenant = buildTenant({ name: 'Test School' })
const school = buildSchool({ tenantId: tenant.id, name: 'Main Campus' })
const user = buildUser({ tenantId: tenant.id, schoolId: school.id, email: 'test@example.com' })
```

Available factories:
- `buildTenant()` — Tenant (id, name, code, domain?, isActive, settings, createdAt, updatedAt)
- `buildSchool()` — School (id, tenantId, name, code, address, phone, email, logoUrl?, motto?, established, settings)
- `buildUser()` — User (id, tenantId, schoolId?, email, passwordHash?, name?, image?, roleId?, isActive, status, createdAt, updatedAt, ...)
- `buildStaff()` — Staff (id, tenantId, schoolId, userId, employeeId, firstName, lastName, ...)
- `buildAcademicYear()`, `buildTerm()`, `buildClassLevel()`, `buildClass()`
- `buildFeeCategory()`, `buildFeeStructure()`, `buildInvoice()`, `buildPayment()`
- `buildRole()`, `buildPermission()`, `buildDelegation()`

All IDs are deterministic sequences (`test_tenant_1`, `test_school_1`, …) via `src/ids.ts`.

## MSW Handlers

Request handlers for the portal's API routes. Two entry points:

- `setupServer()` from `msw/node` — for `bun:test` unit/integration tests
- `setupWorker()` from `msw/browser` — for Playwright E2E (if needed)

```ts
// bun test
import { setupServer } from '@novastar/testing/msw'
import { handlers } from '@novastar/testing/msw/handlers'

const server = setupServer(...handlers)
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

Handlers return a 404-shaped body for unknown resources (never empty 200).

## E2E Page Objects

```ts
import { LoginPage, TenantSwitcher, StudentsPage, createStorageState } from '@novastar/testing/e2e'

const login = new LoginPage(page)
await login.goto()
await login.signIn('user@example.com', 'password')

const switcher = new TenantSwitcher(page)
await switcher.selectTenant('novastar')
```

Storage state: `createStorageState()` signs in once and saves `storageState.json` for reuse. Skips if `E2E_EMAIL`/`E2E_PASSWORD` are unset (matches `e2e/fixtures.ts` `hasCredentials()` behaviour).