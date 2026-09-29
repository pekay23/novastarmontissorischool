# Phase 1 — Architecture & Database Audit

**Repository:** `novastarmontissorischool` (Bun + Turborepo monorepo, Next.js 16 apps, Prisma 7.10)
**Date:** 2026-09-28
**Scope:** `packages/database/prisma/schema.prisma` (1,212 lines), `packages/database/` package structure, Prisma config, migration tooling, tenant/school multi-tenancy design, entity relationships, index strategy, JSON columns, enums, and cross-referencing code in `apps/portal/lib/tenant.ts`, `tools/seed/index.ts`, `tools/db-mirror/mirror.ts`, `docs/technical/2026-09-24_000000-novastar-montessori-master-plan-final.md`, and `docs/adr/README.md`.

---

## Executive Summary

The schema is a **well-structured, thoughtfully normalized domain model** for a multi-tenant school management system. It covers the full Montessori + Ghana GES/NaCCA curriculum domain—academic years, terms, classes, subjects, grading, assessments, finance, attendance, communication, CMS, RBAC, branding, and configuration-first entity definitions. Naming conventions are consistent, composite unique constraints are applied broadly, and decimal precision for financial data is appropriate.

However, **six critical structural gaps** stand between the schema and a production-ready, secure multi-tenant deployment:

1. **There are zero migration files.** The `prisma/migrations/` directory does not exist (it is gitignored), `db:migrate:deploy` is wired into no CI job, and only `db push` — Prisma's destructive schema-sync command — is available. Schema changes are unreviewed, unreproducible, and undeployable.

2. **Multi-tenancy has no database-level enforcement.** The schema includes a `tenantId` column on 38 of 43 models, but there are zero PostgreSQL RLS policies. Tenant isolation is entirely an application-layer convention. The `getTenantContext()` helper in `apps/portal/lib/tenant.ts:25` sources `tenantId` from an environment variable (`process.env.TENANT_ID`) rather than from the authenticated session, creating a direct cross-tenant data leakage vector.

3. **Five models lack `tenantId` entirely**, making per-tenant scoping impossible at the query level for those tables: `Account`, `Session`, `VerificationToken` (auth tables), `GradingLevel` (child of `GradingScale`), and `FeeInvoiceLineItem` (child of `FeeInvoice`).

4. **The Neon→Supabase mirror is missing 9 tables** from its sync list. The `mirror.ts` script (`tools/db-mirror/mirror.ts:52-96`) and the equivalent `setup-pg-cron.sql` (`tools/db-mirror/setup-pg-cron.sql:19-40`) omit `staff_role`, `department`, `fee_structure`, `fee_line_item`, `fee_invoice_line_item`, `class_term`, `leave_request`, `timetable`, and `timetable_entry` — silently discarding data from the read replica.

5. **No explicit `@@index` declarations exist on any model except `AuditLog`** (lines 1210–1211). Foreign key columns that are not part of a `@@unique` constraint have no dedicated index, making joins and lookups full-table scans on any table without a tenant-scoped unique constraint.

6. **Cascade-delete propagation is implicit and unguarded.** With no soft-delete mechanism on `Tenant` or `School`, deleting either entity cascades through the entire data tree (Prisma default `onDelete: Cascade` for required relations). There is no audit trail, no recovery mechanism, and no confirmation gate.

| Severity | Count |
|---|---|
| Critical | 6 |
| High | 11 |
| Medium | 12 |
| Low | 4 |
| **Total** | **33** |

---

## 1. Schema Design Quality

### 1.1 Normalization vs. Denormalization Tradeoffs

**The schema is heavily normalized** with explicit join tables (`SubjectLevel`, `ClassSubject`, `ClassTerm`, `Enrollment`, `AttendanceStudent`, `AttendanceStaff`, `StaffRole`). This is the correct choice for a domain with configurable entity relationships (which `packages/shared-types/config-schema.ts` makes clear via `EntityDefinitionSchema` with dynamic field definitions). The alternative—storing arrays of IDs or denormalized JSON—would be unworkable for a configurable CRUD engine.

**Denormalized array columns** are used selectively where query simplicity outweighs normalization cost:

| Column | Model | Line | Type | Rationale |
|--------|-------|------|------|-----------|
| `Role.permissions` | `Role` | 426 | `String[]` | Permission keys are looked up by role ID; array membership test (`? @>`) is acceptable |
| `Role.inheritsFrom` | `Role` | 427 | `String[]` | Role inheritance chains |
| `Delegation.permissions` | `Delegation` | 465 | `String[]` | Temporary permission grant |
| `StaffRole.permissions` | `StaffRole` | 635 | `String[]` | Role-specific permission list |
| `News.audience` | `News` | 994 | `String[]` | Target audience tags |
| `Event.audience` | `Event` | 1017 | `String[]` | Target audience tags |
| `Message.recipientIds` | `Message` | 920 | `String[]` | Recipients of a message |
| `GradingScale.appliesToLevels` | `GradingScale` | 298 | `String[]` | Which class levels use this scale |
| `AssessmentTypeConfig.appliesToLevels` | `AssessmentTypeConfig` | 332 | `String[]` | Which class levels use this type |
| `ReportTemplate.defaultAudience` | `ReportTemplate` | 1041 | `String[]` | Default audience recipients |

**Finding D-1 — `Message.recipientIds` has no GIN index. HIGH.** Line 920: `recipientIds String[]`. In PostgreSQL this becomes `TEXT[]`. Queries like "find all messages received by user X" use `WHERE recipientIds @> ARRAY['userId']::text[]`, which requires a full table scan without a GIN index. As `Message` is expected to be high-volume (communication layer), this is a latent performance time bomb. Recommendation: add `@@index([tenantId, schoolId], type: Gin, map: "recipientIds_gin")` — or better, model recipients as a join table `MessageRecipient` to enable per-user indexing and read-delivery tracking.

**Finding D-2 — `News.audience` and `Event.audience` have no GIN index. MEDIUM.** Lines 994 and 1017. Same issue as `recipientIds` but lower volume (CMS content, not per-user messaging). Add GIN indexes for tenant-scoped audience filtering.

**Finding D-3 — `ReportTemplate.parameters` is untyped JSON. LOW.** Line 1040: `parameters Json @default("{}")`. The `definition` field on `ConfigEntity` (line 1115) stores the full `EntityDefinition` as JSON, which is a reasonable design for admin-editable schemas. But `ReportTemplate.parameters` duplicates this pattern without clear ownership — it should at minimum reference `ConfigEntity` or use a typed structure.

**Finding D-4 — `Assessment` model has fields declared out of conventional order. LOW.** Lines 766–767: `subject` relation and `subjectId` are declared after `scores` and before `createdAt`/`updatedAt`, and `subjectId` (`String?`) is declared after the `subject` relation that references it. While valid Prisma (field ordering doesn't matter), this is unconventional and confusing for readers. Convention is FK column first, then relation field. Recommendation: move `subjectId String?` before `subject` at line 767.

### 1.2 Composite Unique Constraints Correctness

**Overall: Composite unique constraints are well-designed.** 38 of 43 models include `@@unique` with `tenantId` as the leftmost column, ensuring entity codes/names are scoped to `(tenant, school)`. Examples:

- `School`: `@@unique([tenantId, code])` — line 97
- `Subject`: `@@unique([tenantId, schoolId, code])` — line 200
- `Student`: `@@unique([tenantId, schoolId, studentId])` + `@@unique([tenantId, schoolId, admissionNumber])` — lines 691–692
- `FeeStructure`: `@@unique([tenantId, schoolId, name, academicYearId, classLevelId])` — line 398

**Finding D-5 — Composite uniques with nullable `schoolId` have PostgreSQL NULL semantics. MEDIUM.** 13 models declare `schoolId` as optional (`schoolId String?`): `GradingScale` (293), `AssessmentTypeConfig` (325), `FeeCategory` (346), `PaymentMethodConfig` (365), `Role` (421), `Permission` (450), `StaffRole` (624—wait, let me check). Actually, `StaffRole` has `schoolId String` (required, line 629). Let me correct: the models with nullable `schoolId` are:

- `GradingScale` — line 293: `schoolId String?`
- `AssessmentTypeConfig` — line 325: `schoolId String?`
- `FeeCategory` — line 346: `schoolId String?`
- `PaymentMethodConfig` — line 365: `schoolId String?`
- `Role` — line 421: `schoolId String?`
- `Permission` — line 450: `schoolId String?`
- `StaffRole` — line 629: `schoolId String` (required, not nullable)
- `ReportTemplate` — line 1035: `schoolId String?`
- `ConfigEntity` — line 1107: `schoolId String?`

This is actually the correct pattern: a `NULL` schoolId means "tenant-level" scope (shared across all schools), while a non-null schoolId means "school-level" scope. **However**, PostgreSQL's treatment of NULL in unique constraints means that in all these models, **multiple records with the same `(tenantId, NULL, name)` are allowed** — because PostgreSQL treats NULL as distinct from NULL in unique constraints. So you cannot enforce "one tenant-level record per name" with `@@unique([tenantId, schoolId, name])` alone. This is a data integrity risk: two tenant-level grading scales with the same name could be created, or a tenant-level and a school-level record with the same name could conflict unexpectedly.

**Recommendation:** For models where `schoolId` is nullable and the unique constraint includes it, either:
- Use a partial unique index: `CREATE UNIQUE INDEX ON table (tenantId, name) WHERE schoolId IS NULL;`
- Or use a sentinel value (e.g., `schoolId = tenantId` or a fixed UUID) instead of NULL.
- In Prisma, add explicit `@@index` with `type: Type` and note the PostgreSQL NULL semantics in a comment.

**Finding D-6 — `FeeInvoice.invoiceNumber` is globally unique, not tenant-scoped. HIGH.** Line 847: `invoiceNumber String @unique`. For a multi-tenant system, invoice numbers should be scoped per tenant (or tenant + academic year + term) to allow independent numbering sequences. A global unique constraint prevents tenant A from using invoice number `INV-2026-001` if tenant B already did, even though they should be independent. Recommendation: replace `@unique` with `@@unique([tenantId, invoiceNumber])` and implement per-tenant sequence generation.

**Finding D-7 — `LeaveRequest` has no composite unique constraint. MEDIUM.** Lines 1159–1174. The model tracks leave requests per staff member per date range, which is the classic case for a uniqueness constraint to prevent double-booking. No `@@unique` or `@@index` exists. A query like "is this staff member already on leave for this date range" requires a full scan. Recommendation: add `@@index([tenantId, staffId, startDate, endDate])` and consider a `@@unique([tenantId, staffId, startDate, endDate])` or overlap constraint.

### 1.3 Cascade Delete Behavior

**Finding D-8 — Only two relations specify `onDelete` explicitly, and both are redundant. LOW.** Lines 541 and 560: `Account.user` and `Session.user` both specify `onDelete: Cascade`. Since `userId` is a **required** field (`String`, not `String?`) on both `Account` and `Session`, Prisma's default for required relations is already `Cascade`. The explicit annotation is documentation rather than functional. No other relation in the schema specifies `onDelete`.

**Finding D-9 — Implicit cascade from Tenant/School deletion is destructive and unguarded. CRITICAL.** Deleting a `Tenant` (line 13) or `School` (line 53) cascades through every related model via Prisma's default `Cascade` on required relations. The `Tenant` model has `isActive: Boolean @default(true)` (line 18) for logical disabling, but there is **no database-level protection** against physical `DELETE`. The ORM-level `delete()` call would wipe an entire tenant's data tree in a single operation. There is:

- No soft-delete column (`deletedAt`) on `Tenant` or `School`
- No row-level security policy to prevent `DELETE`
- No cascading archive to a `_deleted` table
- No audit trail on the delete operation itself

**Recommendation:** Implement soft-delete at the application layer for `Tenant` and `School` (add `deletedAt DateTime?` columns, scope all queries with `deletedAt: null`). For other entities, consider whether `SetNull` is more appropriate than `Cascade` — e.g., deleting a `Term` should perhaps null out `termId` on related `Assessment`/`FeeInvoice` records rather than deleting them.

### 1.4 Missing Indexes for Common Query Patterns

**Finding D-10 — Zero explicit `@@index` declarations outside of AuditLog. HIGH.** Only `AuditLog` has indexed columns (lines 1210–1211):
```prisma
@@index([tenantId, schoolId, createdAt])
@@index([tenantId, entity, entityId])
```

All other 42 models rely entirely on their `@@unique` composite constraints for index coverage. While a `@@unique([tenantId, schoolId, code])` does create an index on `(tenantId, schoolId, code)`, it does **not** help queries that filter on `schoolId` alone, or that filter on `status`/`isCurrent`/`date` columns. Common query patterns that suffer:

| Query Pattern | Affected Model | Columns | Line |
|---|---|---|---|
| "Find current term" | `Term` | `isCurrent`, `schoolId` | 130 |
| "Find current academic year" | `AcademicYear` | `isCurrent` | 110 |
| "List assessments for a class" | `Assessment` | `classSubjectId` | 748 |
| "List scores for a student" | `Score` | `studentId` | 776 |
| "Attendance for a date range" | `AttendanceStudent` | `classId`, `date` | 799–801 |
| "Payments for a student" | `Payment` | `studentId` | 880 |
| "Fee invoices for a term" | `FeeInvoice` | `termId`, `studentId` | 844–846 |
| "Enrollments for a class" | `Enrollment` | `classId` | 731 |

**Recommendation:** Add `@@index` blocks for each high-frequency query pattern. Example for `FeeInvoice`:
```prisma
@@index([tenantId, schoolId, studentId])
@@index([tenantId, schoolId, termId])
@@index([tenantId, schoolId, status, dueDate])
```

### 1.5 Missing Audit Trail Columns

**Finding D-11 — No `deletedAt`, `createdBy`, or `updatedBy` columns on any model. MEDIUM.** Every model has `createdAt` and `updatedAt`, but none track *which user* created or modified the record. The `AuditLog` model (line 1195) exists to capture this, but it must be populated by application code — there are no database triggers configured. The schema comment at `docs/adr/README.md:31` says the database package should have "RLS policies," but none are implemented.

**Recommendation:** Add `createdById` and `updatedById` as optional `String?` FK columns on core data models, or implement audit logging via PostgreSQL triggers that write to `AuditLog`.

---

## 2. Multi-Tenancy Architecture

### 2.1 Tenant Isolation Strategy

**Finding MT-1 — Multi-tenancy is application-layer only; no RLS policies exist. CRITICAL.**

The docs (`docs/technical/...master-plan-final.md:31`) describe the database package as "Prisma schema + migrations (RLS policies)" and `docs/adr/README.md:49` lists ADR-002 "Multi-Tenancy: Shared DB with RLS vs Schema-per-Tenant" as Planned. However:

1. **No `schema` directive is used on any model** — the `multiSchema` preview feature is enabled (`schema.prisma:3`) but `@schema("...")` attributes are absent. The schema uses the default public schema only.

2. **Zero RLS policy SQL files exist.** There is no `prisma/migrations/` directory (the feature is in `.gitignore`, line 36) and no SQL files defining `CREATE POLICY` or `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

3. **Tenant scoping is enforced in application code only.** The `getTenantContext()` function in `apps/portal/lib/tenant.ts:18-37` extracts `tenantId` from `process.env.TENANT_ID` (line 25), not from the authenticated session's user record.

**This is the most severe finding in the entire audit.** If `TENANT_ID` is misconfigured, or if any code path bypasses `getTenantContext()`, queries will return data from the wrong tenant or all tenants. There is no database-level guard to prevent:
- A portal user from school A reading school B's students
- A query that accidentally omits the `tenantId` filter from returning cross-tenant records
- A future developer writing a new endpoint without thinking about tenant isolation

**Finding MT-2 — `tenantId` is sourced from an environment variable, not the session. CRITICAL.** Line 25 of `apps/portal/lib/tenant.ts`:
```ts
const tenantId = process.env.TENANT_ID
```

In a proper multi-tenant architecture, the `tenantId` should be derived from the authenticated user's record or session (e.g., `user.tenantId` from the NextAuth session). Sourcing it from an environment variable means:

- The same Next.js deployment instance is hardcoded to a single tenant. Horizontal scaling to multiple tenants on the same instance is impossible.
- If the environment variable is missing or misconfigured, the error surfaces as a `500 ServerConfigError` (line 27) rather than being handled gracefully.
- The `User` model already has a `tenantId` field (line 500), but it is never populated from the session — the code bypasses it entirely.

**Recommendation:** Derive `tenantId` from `session.user.tenantId` (populated at login time). Reserve `process.env.TENANT_ID` only for single-tenant deployments or super-admin operations. Implement PostgreSQL RLS policies with `current_setting('app.tenant_id')` set per-connection.

**Finding MT-3 — School-level scoping is inconsistent across models. HIGH.** Of the 43 models:

- **35 models** have both `tenantId` and `schoolId` (required or optional)
- **5 models** have `tenantId` but **no `schoolId`**: `SubjectLevel` (220), `LeaveRequest` (1159), and the auth models (`Account` 538, `Session` 556, `VerificationToken` 566)
- **3 models** have neither: `GradingLevel` (307, only `gradingScaleId`), `FeeInvoiceLineItem` (861, only `invoiceId`)

For `SubjectLevel`, the school can be derived via the related `Subject` or `ClassLevel` (both have `schoolId`), but direct school-scoped queries require a join. For `LeaveRequest`, the school is derivable via `Staff.schoolId`, but again not directly queryable. For `GradingLevel`, school is derivable via `GradingScale.schoolId`. For `FeeInvoiceLineItem`, school is derivable via `FeeInvoice.schoolId`.

**Recommendation:** For join/link tables that are always accessed through a parent that has `schoolId`, the omission is architecturally defensible — but each such table **must** carry `tenantId` (and ideally `schoolId`) as a denormalized query field for direct filtering. `GradingLevel` and `FeeInvoiceLineItem` lack even `tenantId`, which is a defect.

### 2.2 Cross-Tenant Data Leakage Risk

**Finding MT-4 — Auth tables (`Account`, `Session`, `VerificationToken`) have no tenant isolation. HIGH.**

These three models (lines 538–572) are standard NextAuth.js tables but lack `tenantId` and `schoolId` columns entirely. This means:

- A user from tenant A can have OAuth connections (`Account`) that are indistinguishable from tenant B's
- Session tokens are global — no tenant-based session invalidation is possible without iterating all sessions
- `VerificationToken` (line 566) is keyed by `identifier` (email) globally — a password reset for `user@schoolA.edu` and `user@schoolB.edu` would be independent, but if two tenants use the same email domain, the `identifier` alone doesn't carry tenant context

**Recommendation:** Add `tenantId` to `Account`, `Session`, and `VerificationToken`. Or, switch to a tenant-prefixed `sessionToken` scheme (e.g., `{tenantId}:{uuid}`).

### 2.3 School-Level Scoping Within Tenants

**Finding MT-5 — `Tenant` model has 40 relation fields but no school-level constraints. MEDIUM.** Lines 23–50: the `Tenant` model declares relations to every major entity (`schools`, `users`, `staffs`, `students`, `roles`, etc.). This is correct for the Prisma ORM, but it means the `Tenant` entity is a hub connecting to every table. The `School` model (line 53) similarly has 28 relation fields.

While Prisma handles this fine, the sheer number of relations on `Tenant` creates a maintenance burden: adding a new entity requires updating both the `Tenant` model's relation list and the `School` model's relation list, plus the `@@unique` constraint on the new entity.

**Recommendation:** Consider using `[modelName]?` (optional relation) on `Tenant` only during early development. For production, the bidirectional relations are correct — but consider documenting which entities are tenant-scoped vs. school-scoped vs. tenant-and-school-scoped to make the pattern discoverable.

---

## 3. Performance Concerns

### 3.1 N+1 Query Risks in Relationships

**Finding P-1 — Eager loading is not enforced; N+1 risk is high for deep relationship trees. MEDIUM.**

The schema supports rich nested reads (e.g., `Student` → `enrollments` → `class` → `level` → `subjects` → `classSubjects` → `teacher`), but the Prisma client proxy in `packages/database/index.ts:8-21` is a thin wrapper around `PrismaClient` with no query-level middleware to enforce eager loading or detect N+1 patterns.

The `getTenantContext()` helper in `apps/portal/lib/tenant.ts:76-79` performs a live DB query on every permission check:
```ts
const user = await prisma.user.findUnique({
  where: { id: ctx.userId },
  select: { role: { select: { permissions: true } } },
})
```

If `checkPermission()` (line 71) is called multiple times in a single request (common in component trees), this executes N identical queries. **Recommendation:** Cache the user's role and permissions in the NextAuth session or a request-scoped cache (e.g., `React.createContext` + `React.use` memoization in server components).

**Finding P-2 — No relation-mode or query-engine optimization flags. LOW.** The Prisma client is initialized without `select` defaults or query optimization. With Prisma 7's `@select` inference, queries that only need specific fields without `select` will fetch entire rows. This is a codebase-wide pattern issue, not a schema issue.

### 3.2 Missing Indexes on Foreign Keys and Filter Columns

**Finding P-3 — 16 models have no explicit `@@index` on foreign key columns. HIGH.** See table in §1.4. The specific models and their un-indexed FK columns:

| Model | Un-indexed FKs |
|---|---|
| `Assessment` | `classSubjectId`, `termId`, `typeId`, `createdById` |
| `Score` | `assessmentId`, `studentId`, `gradingScaleId`, `approvedById` |
| `AttendanceStudent` | `studentId`, `classId`, `markedById` |
| `AttendanceStaff` | `staffId`, `markedById` |
| `FeeInvoice` | `studentId`, `termId` |
| `FeeInvoiceLineItem` | `invoiceId`, `categoryId` |
| `Payment` | `invoiceId`, `studentId`, `methodId`, `recordedById` |
| `Enrollment` | `studentId`, `classId`, `termId` |
| `ClassSubject` | `classId`, `subjectId`, `teacherId` |
| `ClassTerm` | `classId`, `termId` |
| `Class` | `levelId`, `classTeacherId` |
| `SubjectLevel` | `subjectId`, `classLevelId` |
| `Staff` | `departmentId`, `managerId` |
| `Student` | `classId`, `houseId`, `parentId` |
| `House` | `patronId` |
| `LeaveRequest` | `staffId`, `approvedById` |

**Prisma auto-creates indexes for `@relation` fields in some providers**, but the behavior is provider-dependent and not guaranteed for all query patterns. PostgreSQL's default behavior does not auto-index FK columns. The `@@unique` constraints that include `tenantId` do create composite indexes, but these are only useful when the query includes all leftmost columns of the composite.

**Recommendation:** Add `@@index` blocks for each FK column used in WHERE clauses, especially for join-table lookups. Example for `Score`:
```prisma
@@index([tenantId, studentId])
@@index([tenantId, assessmentId])
```

### 3.3 Large JSON Columns — Queryability

**Finding P-4 — 9 JSON columns exist with no indexing or queryability support. HIGH.**

| Column | Model | Line | Contents |
|---|---|---|---|
| `settings` | `Tenant` | 19 | Locale, currency, timezone config |
| `settings` | `School` | 65 | School overrides for tenant settings |
| `providerConfig` | `PaymentMethodConfig` | 372 | Payment gateway credentials/configuration |
| `parameters` | `ReportTemplate` | 1040 | Report template parameters |
| `socialLinks` | `Branding` | 1095 | Social media URLs |
| `definition` | `ConfigEntity` | 1115 | Full `EntityDefinition` (fields, form schema) |
| `data` | `Notification` | 959 | Arbitrary notification payload |
| `oldData` | `AuditLog` | 1204 | Pre-change JSON snapshot |
| `newData` | `AuditLog` | 1205 | Post-change JSON snapshot |

All 9 columns use Prisma's `Json` type (`jsonb` in PostgreSQL). None have GIN indexes for JSON key/value querying. None have schema validation. Querying into these columns requires `->>` or `@>` operators with no index support beyond a basic JSONB GIN on the whole column (which Prisma does not auto-create).

**Specific concern — `providerConfig` JSON may contain credentials.** Line 372: `providerConfig Json?`. This column stores payment gateway configuration, which in production will contain API keys, merchant IDs, and webhook secrets. Storing secrets as plaintext JSON in `jsonb` is a security violation. Recommendation: encrypt `providerConfig` at the application layer, or move credential fields to dedicated encrypted columns.

**Specific concern — `definition` JSON is the admin-editable schema.** Line 1115: `definition Json`. This stores the full `EntityDefinition` (per `packages/shared-types/config-schema.ts:89`), which drives the dynamic CRUD engine. Without a JSONB GIN index on `(definition ->> 'type')` or similar, admin UI lookups by entity type are full scans.

**Recommendation:** Add GIN indexes and consider PostgreSQL's JSONB schema validation:
```sql
ALTER TABLE config_entity ADD CONSTRAINT definition_schema 
CHECK (jsonb_typeof(definition) = 'object');
CREATE INDEX idx_config_entity_definition_type ON config_entity ((definition->>'type'));
```

### 3.4 AuditLog Table Growth Strategy

**Finding P-5 — `AuditLog` has only two composite indexes and no partitioning strategy. MEDIUM.**

The `AuditLog` model (line 1195) has:
```prisma
@@index([tenantId, schoolId, createdAt])  // line 1210
@@index([tenantId, entity, entityId])     // line 1211
```

These indexes are well-chosen for the two most common audit query patterns:
1. Time-range queries scoped to a tenant/school: `WHERE tenantId = X AND schoolId = Y AND createdAt BETWEEN ...`
2. Entity-level change history: `WHERE tenantId = X AND entity = 'Student' AND entityId = '...'`

**However:**

- No `@@index` on `userId` — querying "what did this user do?" requires a full scan.
- No `@@index` on `action` — filtering audit logs by action type (e.g., `DELETE`) is a full scan.
- No time-based partitioning — in a school management system with 500 students, 50 staff, and ~1,000 daily transactions across 50 tenants, `AuditLog` could grow to millions of rows within 12–18 months. Without monthly or quarterly partitioning, query performance degrades.
- No TTL or archival strategy — the schema document (`docs/technical/...master-plan-final.md:31`) mentions the database package should have migration capabilities but not archival.

**Recommendation:** Add `@@index([tenantId, userId, createdAt])` and implement PostgreSQL time-based partitioning on `createdAt` (monthly ranges), with an archival job that moves records older than 12 months to a `audit_log_archive` table.

### 3.5 Financial Decimal Precision

**Finding P-6 — `Score.rawScore` uses `Decimal(6, 2)`, limiting to 9999.99. MEDIUM.** Line 777: `rawScore Decimal @db.Decimal(6, 2)`. This is adequate for individual assessment scores (typically 0–100 or 0–500), but if the system supports cumulative or scaled scores (e.g., end-of-year GPA on a 5.0 scale with 4 decimal places, or scaled scores up to 9999), this limit is restrictive.

**Positive:** Financial amounts consistently use `Decimal(12, 2)` (lines 408, 409, 449, 848, 849, 850, 868, 881) — sufficient for amounts up to 999,999,999.99 GHS. This is correct.

**Positive:** `Score.percentage` uses `Decimal(5, 2)` (line 778), allowing up to 999.99%. This accommodates bonus-point scenarios where scores can exceed 100%.

---

## 4. Data Integrity

### 4.1 Enum Usage vs. Lookup Tables

**Finding DI-1 — 14 enums are used inline; no dynamic enum pattern. MEDIUM.**

The schema defines 14 enums:

| Enum | Values | Line |
|------|--------|------|
| `TermStatus` | PLANNING, ACTIVE, ASSESSMENT, REPORTING, CLOSED | 145 |
| `Phase` | KINDERGARTEN, PRIMARY, JHS, SHS | 174 |
| `SubjectCategory` | 14 values (LANGUAGE through OTHER) | 203 |
| `Gender` | MALE, FEMALE, OTHER | 612 |
| `StaffStatus` | ACTIVE, ON_LEAVE, SUSPENDED, TERMINATED | 618 |
| `StudentStatus` | ACTIVE, GRADUATED, TRANSFERRED, WITHDRAWN, SUSPENDED | 695 |
| `AttendanceStatus` | PRESENT, ABSENT, LATE, EXCUSED, HALF_DAY | 830 |
| `InvoiceStatus` | PENDING, PARTIAL, PAID, OVERDUE, CANCELLED, WAIVED | 896 |
| `PaymentStatus` | PENDING, COMPLETED, FAILED, REFUNDED, REVERSED | 905 |
| `MessageChannel` | IN_APP, EMAIL, PUSH, SMS, WHATSAPP | 934 |
| `MessageStatus` | DRAFT, SENT, DELIVERED, READ, FAILED | 942 |
| `NotificationType` | 10 values | 965 |
| `ContentStatus` | DRAFT, PUBLISHED, ARCHIVED | 1025 |
| `ReportType` | 8 values | 1047 |
| `LeaveType` | 8 values | 1176 |
| `LeaveStatus` | PENDING, APPROVED, REJECTED, CANCELLED | 1187 |

**Finding DI-2 — Status enums serve as soft-delete proxies, creating inconsistency. MEDIUM.**

The schema uses two conflicting patterns for soft deletion / inactive state:

| Pattern | Models | Mechanism |
|---|---|---|
| `isActive: Boolean` | `Tenant` (18), `School` (—has it), `ClassTerm` (266), `ClassSubject` (281), `AssessmentTypeConfig` (333), `FeeCategory` (350), `PaymentMethodConfig` (370), `AttendanceTaker` (490), `User` (511), `House` (—), `ConfigEntity` (1117), `ReportTemplate` (1042), `Timetable` (1134), `Branding` (—) | Boolean flag |
| `status` enum | `Term` (131, `TermStatus`), `Staff` (592, `StaffStatus`), `Student` (676, `StudentStatus`), `FeeInvoice` (851, `InvoiceStatus`), `Payment` (887, `PaymentStatus`), `LeaveRequest` (1168, `LeaveStatus`), `News` (995, `ContentStatus`), `Event` (1020, `ContentStatus`), `Message` (924, `MessageStatus`) | Enum state machine |

The inconsistency means querying for "all active students" requires `WHERE status IN ('ACTIVE', 'ON_LEAVE')` while "all active staff" requires `WHERE status IN ('ACTIVE')` (or includes `ON_LEAVE`). Meanwhile, `ClassSubject` uses `isActive: Boolean` but `Assessment` has no active flag at all. This makes it impossible to write a generic "find active entities" query across models.

**Recommendation:** Standardize on a single pattern. Either:
- Use a `status` enum with an `INACTIVE` value for all models (allows richer state, e.g., `PENDING`, `SUSPENDED`, `ARCHIVED`)
- Use `isActive` boolean for all models (simpler but less expressive)

The current hybrid approach is error-prone for both developers and auditors.

### 4.2 Soft Delete Patterns

**Finding DI-3 — Zero soft-delete implementation; `isActive`/`status` is the de facto soft-delete. MEDIUM.**

No model has a `deletedAt DateTime?` column. De facto "soft deletion" is achieved by setting `isActive = false` or `status = 'WITHDRAWN'` / `status = 'CANCELLED'`. This creates problems:

1. **Data recovery is lossy.** Setting `isActive = false` on a `Staff` record doesn't distinguish "fired" from "deleted." There's no `deletedAt` timestamp to know when the record was deactivated.
2. **No tombstone for sync.** The `SyncEngine` (`packages/sync-engine/index.ts:37-53`) uses `syncStatus: 'pending'` for local writes, but the database schema has no equivalent column. If a record is soft-deleted locally and synced, the remote record is marked `inactive` but the sync engine doesn't know whether to skip it or tombstone it.
3. **Cascade-delete risk is unmitigated.** As noted in §1.3, deleting a `School` cascades through the entire data tree with no recovery path.

**Recommendation:** Add `deletedAt DateTime?` to core entities, implement soft-delete via Prisma middleware (`$queryRaw` with `deletedAt IS NULL` scopes), and reserve `isActive`/`status` for business-state transitions.

### 4.3 Timestamp Consistency

**Finding DI-4 — 8 models lack `createdAt`/`updatedAt` fields. MEDIUM.**

| Model | Lines | Has timestamps? |
|---|---|---|
| `Account` | 538–554 | No |
| `Session` | 556–564 | Has `createdAt`, `updatedAt` ✓ |
| `VerificationToken` | 566–572 | No |
| `GradingLevel` | 307–318 | No |
| `ClassTerm` | 259–269 | No |
| `ClassSubject` | 271–286 | No |
| `SubjectLevel` | 220–231 | No |
| `FeeInvoiceLineItem` | 861–871 | No |

The absence is most problematic in `GradingLevel` (line 307): it stores `key`, `label`, `minScore`, `maxScore`, `color`, `order` — fields that an admin might edit. Without `updatedAt`, there's no way to know if the grading scale has been modified since last sync, which is critical for the offline-first sync engine (`package.json:3`).

**Finding DI-5 — `FeeInvoice` uses `issuedAt` instead of `createdAt`. LOW.** Line 853: `issuedAt DateTime @default(now())`. This is semantically appropriate (an invoice is "issued" at a point in time), but the inconsistency with `createdAt` on other models means audit-log correlation across entities is harder. The `AuditLog.entity` and `AuditLog.createdAt` fields use the standard naming, so correlating "when was this invoice created in the audit log" vs. "when was it issued" is possible but non-obvious.

---

## 5. Best Practices

### 5.1 Prisma 7+ Patterns

**Finding BP-1 — `multiSchema` is listed as a `previewFeature` in Prisma 7. MEDIUM.**

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["multiSchema"]  // line 3
}
```

In Prisma 7, `multiSchema` is **GA** (generally available) and no longer requires the `previewFeatures` flag. The flag is silently ignored in Prisma 7. More importantly, **no model uses the `@schema("...")` attribute**, so the entire feature is enabled-but-unused dead configuration. The master plan (`docs/technical/...master-plan-final.md:31`) calls for "RLS policies" and ADR-002 (`docs/adr/README.md:49`) discusses multi-tenancy strategy, but no schema-level multi-schema setup exists.

**Recommendation:** Remove `previewFeatures = ["multiSchema"]` from the generator block (it's GA in Prisma 7). If schema-per-tenant is planned, add `@schema("tenant_novastar")` (or similar) to model definitions. If not planned, document the decision in ADR-002.

**Finding BP-2 — `datasource db` omits `url`; relies on `prisma.config.ts`. LOW.** Lines 6–10:
```prisma
datasource db {
  provider = "postgresql"
  // URL moved to prisma.config.ts for Prisma 7+
}
```

This is the correct Prisma 7 pattern (`prisma.config.ts:4-7` provides `datasource.url`). However, the `defineConfig` in `prisma.config.ts:1` imports from `@prisma/config`, which is declared in `package.json` as `^7.10.0` in `devDependencies` — but it's the **root** devDependencies, not the `packages/database` package. This works because of Bun's workspace resolution, but it's fragile: if the database package is installed standalone, `@prisma/config` would be missing.

**Recommendation:** Add `@prisma/config` to `packages/database/package.json:devDependencies` to make the package self-contained.

### 5.2 Schema Documentation & Comments

**Finding BP-3 — Only 3 comments exist in the entire 1,212-line schema. LOW.**

The schema has section separators:
- `// ============ TENANCY ============` (line 12)
- `// ============ CONFIGURABLE ACADEMIC STRUCTURE ===========` (line 100)
- `// ============ CONFIGURABLE GRADING ===========` (line 288)
- `// ============ CONFIGURABLE ASSESSMENT TYPES ===========` (line 320)
- `// ============ CONFIGURABLE FEES ===========` (line 341)
- `// ============ DYNAMIC RBAC ===========` (line 416)
- `// ============ ATTENDANCE TAKERS (Configurable) ===========` (line 477)
- `// ============ USERS & STAFF ===========` (line 497)
- `// ============ STUDENTS ===========` (line 659)
- `// ============ ASSESSMENT & SCORES ===========` (line 740)
- `// ============ ATTENDANCE ===========` (line 793)
- `// ============ FINANCE ===========` (line 838)
- `// ============ COMMUNICATION ===========` (line 913)
- `// ============ CMS ===========` (line 979)
- `// ============ HOUSES ===========` (line 1058)
- `// ============ BRANDING ===========` (line 1077)
- `// ============ CONFIG ENTITY DEFINITIONS (Admin-editable schema) ===========` (line 1102)
- `// ============ TIMETABLE ===========` (line 1124)
- `// ============ LEAVE MANAGEMENT ===========` (line 1158)
- `// ============ AUDIT ===========` (line 1194)

The section separator comments are good, but there are **zero** inline field-level or model-level documentation comments explaining business rules, constraints, or intended usage. For example:

- `ClassLevel.phase` (line 161): What does `Phase` mean? (Montessori phases: KINDERGARTEN, PRIMARY, JHS, SHS)
- `ClassLevel.ageMin`/`ageMax` (lines 163–164): These are duplicated from the seed data (see `tools/seed/index.ts:154-175`).
- `GradingScale.isDefault` (line 297): What does "default" mean? Tenant-wide or school-wide?
- `TimetableEntry.dayOfWeek` (line 1148): Comment says `1=Monday, 7=Sunday` — this is the only useful inline comment in the schema.

**Recommendation:** Add `@@comment` directives (via `comment` attribute) and inline `?` field comments for:
- Nullable fields (why is `schoolId` nullable — tenant-level scope?)
- Business rule constraints (e.g., "only one grading scale can be `isDefault` per tenant")
- Enum value semantics

### 5.3 Naming Conventions Consistency

**Finding BP-4 — Field ordering is inconsistent across models. LOW.**

Some models declare fields in the order: `id → tenantId → schoolId → business fields → timestamps → relations`:
```
// Tenant (line 13) — correct
id, name, code, domain, isActive, settings, createdAt, updatedAt, relations
```

Other models interleave relations and data fields:
```
// Assessment (line 741) — unusual
[FKs + relations] → [data fields] → [scores relation] → [timestamps] → [subject relation + subjectId]
```

And the `Permission` model (line 436) declares `schoolId` **after** `school` relation:
```
436: model Permission {
...
449:   school      School?  @relation(fields: [schoolId], references: [id])
450:   schoolId    String?
```

While valid Prisma, this is confusing. The convention `@id → tenantId/schoolId → other data → relations last` is followed in most models but not all.

**Finding BP-5 — `VerificationToken` uses snake_case column names without explicit mapping. LOW.** Lines 566–572:
```prisma
model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
}
```

Prisma maps `identifier` and `expires` to `identifier` and `expires` in PostgreSQL (no transformation needed since they're already snake_case). However, the rest of the schema uses camelCase field names that Prisma maps to snake_case columns automatically. The `VerificationToken` model is inconsistent in that it uses snake_case field names — this is actually the NextAuth.js convention. It's fine but worth noting.

### 5.4 Migration Strategy and Versioning

**Finding BP-6 — Zero migration files; `.gitignore` blocks `prisma/migrations/`. CRITICAL.**

```gitignore
# Prisma
prisma/migrations/  # line 36 of .gitignore
```

The `packages/database/prisma/` directory contains only `schema.prisma` (1,212 lines) and `prisma.config.ts` (8 lines). There is no `migrations/` subdirectory. The `package.json` scripts include:
```json
"db:push": "prisma db push",        // line 8 — destructive: drops/updates columns directly
"db:migrate": "prisma migrate dev", // line 9 — dev only, no deploy
"db:migrate:deploy": "prisma migrate deploy"  // line 10 — not wired into CI
```

From `docs/technical/...master-plan-final.md:567`: the technical spike "Prisma RLS multi-tenancy + Neon connection" was planned but no migration infrastructure was built. The mirror script (`tools/db-mirror/mirror.ts:52-96`) references table names in snake_case for the sync job, but there's no migration that creates RLS policies.

**Consequences:**
1. **No reproducible environments.** Running `db push` on a fresh database recreates the schema, but there's no version history. A new developer or new environment has no way to know what the schema should look like at any given point in time.
2. **No CI/CD migration step.** The CI workflow (`.github/workflows/ci.yml`) was reported in Phase 6 audit as not running `db:migrate:deploy`. Schema changes to the production Neon database are applied via `db push` (which is destructive — it drops columns without warning).
3. **No migration review process.** Schema changes proposed in a PR cannot be reviewed as SQL diffs. Reviewers must eyeball the Prisma schema.

**Recommendation:**
1. Remove `prisma/migrations/` from `.gitignore` (un-ignore migrations — they are source code).
2. Create an initial migration: `npx prisma migrate dev --name init` — this creates `prisma/migrations/<timestamp>_init/` with `migration.sql` and `migration.sql.map`.
3. Wire `db:migrate:deploy` into CI: `npx prisma migrate deploy` before `db:generate`.
4. Adopt a migration review checklist: "Does this migration add an index? Does it backfill data? Does it risk downtime on large tables?"

**Finding BP-7 — The mirror script `setup-pg-cron.sql` hardcodes table names that will drift from the schema. HIGH.**

The `tools/db-mirror/setup-pg-cron.sql:19-40` hardcodes 34 table names in a PL/pgSQL array. When any new table is added to the Prisma schema (or existing tables are renamed), the mirror script silently fails to sync that table. The `mirror.ts` Node.js script (`tools/db-mirror/mirror.ts:52-96`) duplicates the same list. **These lists are already out of sync with the schema** — see §2.3 and §3.4.

**Recommendation:** Generate the table list dynamically from `information_schema.tables` at sync time, or use an include/exclude pattern that defaults to "all tables except auth/session tables."

---

## Appendix A: Model-by-Model Tenant/School Coverage

| Model | Lines | `tenantId`? | `schoolId`? | `schoolId` nullable? | `@@unique` includes `tenantId`? | `@@index` beyond unique? |
|-------|-------|-------------|-------------|---------------------|-------------------------------|------------------------|
| `Tenant` | 13 | N/A (root) | N/A | N/A | N/A | No |
| `School` | 53 | ✓ | N/A (root) | N/A | ✓ `([tenantId, code])` | No |
| `AcademicYear` | 101 | ✓ | required | N/A | ✓ `([tenantId, schoolId, name])` | No |
| `Term` | 119 | ✓ | required | N/A | ✓ `([tenantId, schoolId, name, academicYearId])` | No |
| `ClassLevel` | 153 | ✓ | required | N/A | ✓ `([tenantId, schoolId, code])` | No |
| `Subject` | 181 | ✓ | required | N/A | ✓ `([tenantId, schoolId, code])` | No |
| `SubjectLevel` | 220 | ✓ | **missing** | — | ✓ `([tenantId, subjectId, classLevelId])` | No |
| `Class` | 233 | ✓ | required | N/A | ✓ `([tenantId, schoolId, name, levelId])` | No |
| `ClassTerm` | 259 | ✓ | **derivable** | — | ✓ `([tenantId, classId, termId])` | No |
| `ClassSubject` | 271 | ✓ | **derivable** | — | ✓ `([tenantId, classId, subjectId])` | No |
| `GradingScale` | 289 | ✓ | optional | nullable | ✓ `([tenantId, schoolId, name])` | No |
| `GradingLevel` | 307 | **missing** | **missing** | — | No | No |
| `AssessmentTypeConfig` | 321 | ✓ | optional | nullable | ✓ `([tenantId, schoolId, code])` | No |
| `FeeCategory` | 342 | ✓ | optional | nullable | ✓ `([tenantId, schoolId, code])` | No |
| `PaymentMethodConfig` | 361 | ✓ | optional | nullable | ✓ `([tenantId, schoolId, code])` | No |
| `FeeStructure` | 380 | ✓ | required | N/A | ✓ `([tenantId, schoolId, name, academicYearId, classLevelId])` | No |
| `FeeLineItem` | 401 | ✓ | **derivable** | — | ✓ `([tenantId, feeStructureId, categoryId])` | No |
| `Role` | 417 | ✓ | optional | nullable | ✓ `([tenantId, schoolId, name])` | No |
| `Permission` | 436 | ✓ | optional | nullable | ✓ `([tenantId, key])` | No |
| `Delegation` | 455 | ✓ | required | N/A | — (no @@unique) | No |
| `AttendanceTaker` | 478 | ✓ | required | N/A | ✓ `([tenantId, schoolId, classId, staffId])` | No |
| `User` | 498 | ✓ | optional | nullable | ✓ `([tenantId, email])` | No |
| `Account` | 538 | **missing** | **missing** | — | — (no @@unique with tenantId) | No |
| `Session` | 556 | **missing** | **missing** | — | — | No |
| `VerificationToken` | 566 | **missing** | **missing** | — | — (no @id) | No |
| `Staff` | 574 | ✓ | required | N/A | ✓ `([tenantId, schoolId, employeeId])` | No |
| `StaffRole` | 625 | ✓ | required | N/A | ✓ `([tenantId, schoolId, name])` | No |
| `Department` | 643 | ✓ | required | N/A | ✓ `([tenantId, schoolId, code])` | No |
| `Student` | 660 | ✓ | required | N/A | ✓ `([tenantId, schoolId, studentId])` ✓ `([tenantId, schoolId, admissionNumber])` | No |
| `Parent` | 703 | ✓ | required | N/A | ✓ `([tenantId, schoolId, phone])` | No |
| `Enrollment` | 725 | ✓ | **derivable** | — | ✓ `([tenantId, studentId, termId])` | No |
| `Assessment` | 741 | ✓ | required | N/A | — (no @@unique) | No |
| `Score` | 770 | ✓ | **derivable** | — | ✓ `([tenantId, assessmentId, studentId])` | No |
| `AttendanceStudent` | 794 | ✓ | **derivable** | — | ✓ `([tenantId, studentId, date, period])` | No |
| `AttendanceStaff` | 813 | ✓ | **derivable** | — | ✓ `([tenantId, staffId, date, period])` | No |
| `FeeInvoice` | 839 | ✓ | required | N/A | — (only `@unique invoiceNumber`) | No |
| `FeeInvoiceLineItem` | 861 | **missing** | **derivable** | — | — (no @@unique) | No |
| `Payment` | 873 | ✓ | required | N/A | — (no @@unique) | No |
| `Message` | 914 | ✓ | required | N/A | — (no @@unique) | No |
| `Notification` | 950 | ✓ | required | N/A | — (no @@unique) | No |
| `News` | 980 | ✓ | required | N/A | ✓ `([tenantId, schoolId, slug])` | No |
| `Event` | 1005 | ✓ | required | N/A | — (no @@unique) | No |
| `ReportTemplate` | 1031 | ✓ | optional | nullable | — (no @@unique) | No |
| `House` | 1059 | ✓ | required | N/A | ✓ `([tenantId, schoolId, name])` | No |
| `Branding` | 1078 | ✓ | required | N/A | ✓ `([tenantId, schoolId])` — singleton | No |
| `ConfigEntity` | 1103 | ✓ | optional | nullable | ✓ `([tenantId, type])` | No |
| `Timetable` | 1125 | ✓ | **derivable** | — | ✓ `([tenantId, classId, termId, name])` | No |
| `TimetableEntry` | 1141 | ✓ | **derivable** | — | ✓ `([tenantId, timetableId, dayOfWeek, startTime, classSubjectId])` | No |
| `LeaveRequest` | 1159 | ✓ | **missing** | — | — (no @@unique) | No |
| `AuditLog` | 1195 | ✓ | required | N/A | — | ✓ 2 indexes |

---

## Appendix B: Mirror Script Table Coverage Gap

Tables in the Prisma schema (43 models) vs. tables in the mirror sync list (34 tables in `mirror.ts` / `setup-pg-cron.sql`):

**Missing from mirror (9 tables):**
1. `staff_role` — role-to-staff assignments
2. `department` — organizational departments
3. `fee_structure` — fee structure definitions
4. `fee_line_item` — line items within fee structures
5. `fee_invoice_line_item` — line items within invoices
6. `class_term` — class-term associations
7. `leave_request` — staff leave requests
8. `timetable` — class timetables
9. `timetable_entry` — individual timetable entries

**Intentionally excluded (auth/ephemeral):**
- `account` (OAuth credentials — correct exclusion)
- `session` (ephemeral tokens — correct exclusion)
- `verification_token` (ephemeral tokens — correct exclusion)

---

## Appendix C: Consolidated Findings Summary

| ID | Finding | Severity | Location |
|----|---------|----------|----------|
| BP-6 | Zero migration files; migrations gitignored; `db:migrate:deploy` not in CI | Critical | `.gitignore:36`, `packages/database/package.json:8-10` |
| MT-1 | No PostgreSQL RLS policies; tenant isolation is application-layer only | Critical | `schema.prisma:1-1122`, `docs/adr/README.md:49` |
| MT-2 | `tenantId` sourced from `process.env.TENANT_ID` not session | Critical | `apps/portal/lib/tenant.ts:25` |
| D-9 | Implicit cascade-delete from Tenant/School without soft-delete or guardrails | Critical | `schema.prisma:13`, `:53` |
| BP-7 | Mirror script hardcodes table list and is missing 9 tables | Critical | `tools/db-mirror/mirror.ts:52-96`, `setup-pg-cron.sql:19-40` |
| D-1 | `Message.recipientIds` has no GIN index | High | `schema.prisma:920` |
| D-6 | `FeeInvoice.invoiceNumber` is globally unique, not tenant-scoped | High | `schema.prisma:847` |
| MT-3 | 5 models lack `schoolId`; 3 models lack both `tenantId` and `schoolId` | High | `schema.prisma:220, 307, 538, 556, 566, 861, 1159` |
| MT-4 | Auth tables (Account, Session, VerificationToken) have no tenantId | High | `schema.prisma:538-572` |
| D-10 | Only AuditLog has `@@index`; 16 models have un-indexed FK columns | High | `schema.prisma:1210-1211` |
| P-4 | 9 JSON columns with no GIN indexes or validation; `providerConfig` may contain secrets | High | `schema.prisma:19, 65, 372, 959, 1040, 1095, 1115, 1204-1205` |
| DI-2 | Inconsistent soft-delete patterns (`isActive` boolean vs `status` enum) | Medium | `schema.prisma:18, 131, 266, 281, 333, 592, 676, 851, 887, 924, 995, 1020, 1168` |
| P-3 | No `@@index` on FK columns used in WHERE clauses | High (see D-10) | See D-10 table above |
| BP-1 | `multiSchema` listed as preview feature in Prisma 7; no model uses it | Medium | `schema.prisma:3` |
| P-5 | AuditLog has only 2 indexes, no partitioning strategy for growth | Medium | `schema.prisma:1195-1212` |
| DI-1 | 14 enums inline; no dynamic enum pattern despite config-first architecture | Medium | `schema.prisma:145-1185` |
| DI-3 | No `deletedAt` soft-delete column on any model | Medium | All models |
| DI-4 | 8 models lack `createdAt`/`updatedAt` | Medium | `schema.prisma:307, 259, 271, 220, 861, 538, 566` |
| D-5 | Composite uniques with nullable `schoolId` have PostgreSQL NULL semantics | Medium | `schema.prisma:293, 325, 346, 365, 421, 450, 1035, 1107` |
| D-7 | LeaveRequest has no unique constraint for date-range overlap | Medium | `schema.prisma:1159-1174` |
| D-8 | Only 2 relations specify `onDelete`, both redundant | Low | `schema.prisma:541, 560` |
| P-1 | No eager-loading enforcement; N+1 risk in `getTenantContext()` | Medium | `apps/portal/lib/tenant.ts:76-79` |
| P-2 | No query-engine optimization flags on Prisma client | Low | `packages/database/index.ts:23-33` |
| P-6 | `Score.rawScore Decimal(6, 2)` limits to 9999.99 | Medium | `schema.prisma:777` |
| D-4 | Assessment model fields declared out of order | Low | `schema.prisma:741-768` |
| BP-2 | `@prisma/config` only in root devDependencies, not in database package | Low | `packages/database/package.json:26-30` |
| BP-3 | Zero inline field-level documentation comments | Low | `schema.prisma` (entire file) |
| BP-4 | Inconsistent field ordering across models | Low | `schema.prisma` (various) |
| BP-5 | VerificationToken uses snake_case field names (inconsistent) | Low | `schema.prisma:566-572` |
| D-2 | `News.audience` and `Event.audience` String[] have no GIN index | Medium | `schema.prisma:994, 1017` |
| DI-5 | FeeInvoice uses `issuedAt` instead of `createdAt` | Low | `schema.prisma:853` |

---

## Key Recommendations (Prioritized)

### Immediate (Critical)
1. **Generate and commit the initial migration.** `cd packages/database && npx prisma migrate dev --name init`. Remove `prisma/migrations/` from `.gitignore`. Wire `db:migrate:deploy` into CI.
2. **Implement RLS policies.** At minimum, create `app.tenant_id` GUC, set it per-connection, and add `CREATE POLICY` for `Tenant`/`School`/`User`. Start with tenant-scoped tables.
3. **Fix `getTenantContext()` to derive `tenantId` from the session, not `process.env`.** Add `tenantId` to the NextAuth session payload.
4. **Fix the mirror table list.** Add the 9 missing tables to both `mirror.ts` and `setup-pg-cron.sql`. Better: generate dynamically from `information_schema.tables`.
5. **Add `deletedAt DateTime?` to `Tenant` and `School`.** Implement soft-delete middleware. Document that physical `DELETE` is a privileged operation.

### Short-Term (High)
6. **Add `@@index` blocks** for all FK columns and high-frequency filter columns (`status`, `isCurrent`, `date`).
7. **Add `tenantId` to `Account`, `Session`, `VerificationToken`, `GradingLevel`, `FeeInvoiceLineItem`.**
8. **Add `schoolId` to `SubjectLevel` and `LeaveRequest`** (denormalized for query performance).
9. **Add GIN indexes** on `Message.recipientIds`, `News.audience`, `Event.audience`.
10. **Encrypt `PaymentMethodConfig.providerConfig`** or move credential fields to a dedicated encrypted column.

### Medium-Term (Medium)
11. **Standardize soft-delete** on a single pattern (`deletedAt DateTime?` + `status` enum).
12. **Scope `FeeInvoice.invoiceNumber` per-tenant.**
13. **Remove `previewFeatures = ["multiSchema"]`** if not actively used, or implement schema-per-tenant if planned.
14. **Add `createdAt`/`updatedAt` to the 8 models missing them.**
15. **Implement partial unique indexes** for nullable `schoolId` columns.
16. **Add time-based partitioning** for `AuditLog`.

---

## Pros and Cons of Current Approach

### Pros
- **Clean, normalized domain model** — 43 models with consistent naming, explicit join tables, and well-structured relationships.
- **Comprehensive multi-tenancy scaffolding** — 38 of 43 models include `tenantId`; 35 include `schoolId`; composite unique constraints are the norm, not the exception.
- **Correct financial decimal precision** — all monetary fields use `Decimal(12, 2)`; scores use `Decimal(6, 2)` and `Decimal(5, 2)` appropriately.
- **Configuration-first design** — `ConfigEntity` model (lines 1103–1122) supports admin-editable entity definitions, aligning with `packages/shared-types/config-schema.ts`.
- **Appropriate enum usage** — 14 enums cover the domain vocabulary (statuses, phases, categories, channels) with clear value sets.
- **AuditLog indexing is well-designed** — the two composite indexes (lines 1210–1211) match the two most common audit query patterns.
- **Neon + Supabase mirror strategy** is architecturally sound (pg_cron, zero CI minutes) even though the implementation is incomplete.

### Cons
- **Migrations are entirely absent** — the schema is managed via `db push` only, making changes unreviewed, unreproducible, and undeployable.
- **Tenant isolation is an application-layer convention, not a database guarantee** — no RLS policies, no `app.tenant_id` GUC, no DB-level enforcement.
- **`tenantId` is sourced from an env var** in the request handler — a single misconfiguration exposes cross-tenant data.
- **9 JSON columns lack indexing** — `jsonb` queries on `settings`, `definition`, `providerConfig`, `data`, etc. require full scans.
- **16 models have un-indexed FK columns** — only `@@unique` composite constraints provide index coverage, and only for specific column combinations.
- **No soft-delete mechanism** — `isActive` and `status` enums are the de facto de facto soft-delete, but there's no `deletedAt` timestamp, no recovery, and no protection against cascade deletion of `Tenant`/`School`.
- **Mirror script has hardcoded, stale table lists** — missing 9 tables means data loss in the read replica.
- **Auth tables (`Account`, `Session`, `VerificationToken`) are not tenant-scoped** — OAuth connections and sessions span all tenants.
- **`VerificationToken` has no primary key** — relies on composite `@@unique` only, which Prisma handles but PostgreSQL treats as a heap table.
- **No `createdAt`/`updatedAt` on 8 models** — `GradingLevel`, `ClassTerm`, `ClassSubject`, `SubjectLevel`, `FeeInvoiceLineItem`, `Account`, `VerificationToken`.
- **Inconsistent soft-delete pattern** — some models use `isActive: Boolean`, others use `status` enums, with no unified query interface.
- **`providerConfig` JSON may store payment credentials in plaintext** — a compliance and security risk.
- **`FeeInvoice.invoiceNumber` is globally unique** — prevents independent per-tenant numbering sequences.

---