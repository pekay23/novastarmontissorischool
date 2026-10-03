-- Failsafe parity DDL: brings the Supabase failsafe up to the primary's
-- table set so tools/migrate's require-backup guard stops refusing writes.
--
-- Missing tables at generation time (7): PlatformOperator, Syllabus, Passkey, PasskeyChallenge, SystemConfig, SystemError, LogEntry
-- Missing enums at generation time (3): UserStatus, ErrorSeverity, LogLevel
--
-- Generated from packages/database/prisma/migrations by gen-parity-ddl.ts.
-- ONE-SHOT, applied atomically by tools/db-mirror/apply-schema.ts.

-- 20261002103000_platform_config
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED');

-- 20261002103000_platform_config
-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- 20261002103000_platform_config
-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- 20261002103000_platform_config
-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "name" TEXT,
    "transports" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- 20261002103000_platform_config
-- CreateTable
CREATE TABLE "PasskeyChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasskeyChallenge_pkey" PRIMARY KEY ("id")
);

-- 20261002103000_platform_config
-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- 20261002103000_platform_config
-- CreateTable
CREATE TABLE "SystemError" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "errorType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "endpoint" TEXT,
    "userId" TEXT,
    "severity" "ErrorSeverity" NOT NULL DEFAULT 'MEDIUM',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemError_pkey" PRIMARY KEY ("id")
);

-- 20261002103000_platform_config
-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- 20261002103000_platform_config
-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- 20261002103000_platform_config
-- CreateIndex
CREATE UNIQUE INDEX "PasskeyChallenge_challenge_key" ON "PasskeyChallenge"("challenge");

-- 20261002103000_platform_config
-- CreateIndex
CREATE INDEX "PasskeyChallenge_expiresAt_idx" ON "PasskeyChallenge"("expiresAt");

-- 20261002103000_platform_config
-- CreateIndex
CREATE INDEX "SystemConfig_tenantId_category_idx" ON "SystemConfig"("tenantId", "category");

-- 20261002103000_platform_config
-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_tenantId_key_key" ON "SystemConfig"("tenantId", "key");

-- 20261002103000_platform_config
-- CreateIndex
CREATE INDEX "SystemError_tenantId_severity_createdAt_idx" ON "SystemError"("tenantId", "severity", "createdAt");

-- 20261002103000_platform_config
-- CreateIndex
CREATE INDEX "SystemError_tenantId_resolved_createdAt_idx" ON "SystemError"("tenantId", "resolved", "createdAt");

-- 20261002103000_platform_config
-- CreateIndex
CREATE INDEX "LogEntry_level_createdAt_idx" ON "LogEntry"("level", "createdAt");

-- 20261002103000_platform_config
-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261002103000_platform_config
-- AddForeignKey
ALTER TABLE "PasskeyChallenge" ADD CONSTRAINT "PasskeyChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 20261002103000_platform_config
-- AddForeignKey
ALTER TABLE "SystemError" ADD CONSTRAINT "SystemError_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 20261002103000_platform_config
-- AddForeignKey
ALTER TABLE "SystemError" ADD CONSTRAINT "SystemError_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 20261002103000_platform_config
-- AddForeignKey
-- The last two constraints are the tenant relations the 28 models in
-- 20260929000000_init already declare: without them SystemConfig and
-- SystemError held a bare tenantId, so orphaned rows survived a tenant
-- deletion. RESTRICT matches that migration's ON DELETE action for every
-- required tenant relation. Unlike the statements above, these two validate
-- existing rows, so a database that already carries orphans for a deleted
-- tenant will fail here until they are cleared.
ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261002103000_platform_config
-- AddForeignKey
ALTER TABLE "SystemError" ADD CONSTRAINT "SystemError_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261003000000_unifiedtransform_port_wave0
-- CreateTable
-- The unique indexes above are NOT recreated: their definitions are unchanged,
-- and PostgreSQL keeps them across a nullability change. No index rebuild needed.
--
-- "ContentStatus" already exists — it is declared in 20260929000000_init and
-- reused here rather than created again.
CREATE TABLE "Syllabus" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT,
    "classSubjectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "topics" TEXT[],
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No DEFAULT here, and that is load-bearing. schema.prisma declares
    -- `updatedAt DateTime @updatedAt` with no `@default(now())`, so Prisma
    -- expects a bare NOT NULL column and `migrate diff` reports a column
    -- default as drift. Prisma supplies this value on every write, so the
    -- default was never needed; keeping it made the chain diverge from the
    -- datamodel. Every other @updatedAt column in this chain is written the
    -- same way — for example "updatedAt" in 20260929000000_init.
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Syllabus_pkey" PRIMARY KEY ("id")
);

-- 20261003000000_unifiedtransform_port_wave0
-- CreateIndex
-- One syllabus document per subject per term.
CREATE UNIQUE INDEX "Syllabus_tenantId_classSubjectId_termId_title_key" ON "Syllabus"("tenantId", "classSubjectId", "termId", "title");

-- 20261003000000_unifiedtransform_port_wave0
-- CreateIndex
CREATE INDEX "Syllabus_tenantId_termId_idx" ON "Syllabus"("tenantId", "termId");

-- 20261003000000_unifiedtransform_port_wave0
-- AddForeignKey
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261003000000_unifiedtransform_port_wave0
-- AddForeignKey
-- Optional relation, so SET NULL: deleting a school must not delete the
-- syllabus, it must detach it. Matches GradingScale_schoolId_fkey in init.
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 20261003000000_unifiedtransform_port_wave0
-- AddForeignKey
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "ClassSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261003000000_unifiedtransform_port_wave0
-- AddForeignKey
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261003164500_platform_operator
-- Per-operator platform console accounts.
--
-- Adds:
--   * PlatformOperator         — a real identity for apps/super-admin, replacing
--                                the shared SUPER_ADMIN_SECRET passphrase and the
--                                SUPER_ADMIN_EMAIL allowlist
--   * AuditLog.operatorId      — makes a console action attributable to a person
--   * PlatformOperator lockout index — serves the lockout sweep
--
-- WHY A NEW MODEL AND NOT A `User` ROW
-- ------------------------------------
-- `User.tenantId` is non-null, so there is no correct row for a platform
-- operator: they belong to no tenant. Making the column nullable would make
-- "belongs to no school" a value every portal query has to defend against, and
-- borrowing `HEADMASTER` would hand a cross-tenant account a school-level role —
-- the exact outcome `apps/super-admin` exists to prevent. `PlatformOperator` is
-- the deliberate third option, and its absence is why the console was limited to
-- one shared passphrase with no individual identity.
--
-- `status` reuses the existing `UserStatus` enum; no second lifecycle enum is
-- created here, so "suspended" means one thing platform-wide.
--
-- STATUS: WRITTEN BUT NOT APPLIED. Nothing in this file has been executed
-- against any database. Do not run `prisma migrate deploy` to apply it — see the
-- deployment note below. Apply with `prisma db push`, which is diff-based,
-- idempotent, and derives the same statements from schema.prisma.
--
-- DEPLOYMENT NOTE — read before running anything:
-- This database has no `_prisma_migrations` ledger; the live schema was built
-- with `prisma db push`. `20260929000000_init` is therefore NOT applied, and
-- running `prisma migrate deploy` would fail partway through init and leave a
-- corrupt ledger. Until `tools/migrate baseline` reconciles the history (see
-- docs/technical/2026-10-01_000000-build-plan-tools-migrate.md), apply schema
-- changes with `prisma db push`, which is diff-based and idempotent.
--
-- This migration is additive — no DROPs, no column type changes, and every new
-- NOT NULL column carries a DEFAULT — so it is safe against a populated database.
--
-- Two notes a reader should not have to infer:
--
-- 1. `"capabilities" TEXT[]` carries no NOT NULL, and that is Prisma's own output
--    for a required scalar list rather than an omission here: `20260929000000_init`
--    renders `Role.permissions` and `GradingScale.appliesToLevels` exactly the same
--    way. Rewriting it as NOT NULL would make this file disagree with the diff
--    `prisma migrate diff` derives from `schema.prisma`, and this deployment applies
--    schema changes with `prisma db push`, where that disagreement is drift.
--
--    What matters is that the value is never defaulted, because a default here would
--    be an invented authorisation. Every writer must name it, and there are two:
--    `novastar-tenant operator` (bootstrap and password reset) and a row edited by
--    hand. A row holding `{}` grants nothing and is therefore refused everywhere —
--    deny by default, not an implicit superuser. A row holding NULL is not a shape
--    the application can produce: the CLI always writes an array, and the sign-in
--    path narrows whatever it reads through the capability vocabulary before use.
--
-- 2. Every existing `AuditLog` row reads as `operatorId = NULL` afterwards, which
--    is exactly right and not a data loss. Those entries were written by a
--    console that had no operator rows to point at, so NULL is the truth about
--    them. They are indistinguishable from portal-written entries, which was
--    already the case.
--
-- Statement order is not load-bearing here, and there is no backfill to run: the
-- only foreign key added is `AuditLog.operatorId`, nullable and SET NULL, so it
-- cannot fail against existing rows.

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "operatorId" TEXT;

-- 20261003164500_platform_operator
-- CreateTable
-- "updatedAt" carries no DEFAULT, matching every other @updatedAt column in this
-- chain: Prisma supplies it on every write, so a default was never needed and
-- keeping one would make `migrate diff` report drift.
CREATE TABLE "PlatformOperator" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "capabilities" TEXT[],
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "loginAttempts" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("id")
);

-- 20261003164500_platform_operator
-- CreateIndex
-- Two independent uniques, and the reason a login identifier can be either a
-- username or an email: each resolves to at most one operator on its own.
CREATE UNIQUE INDEX "PlatformOperator_username_key" ON "PlatformOperator"("username");

-- 20261003164500_platform_operator
-- CreateIndex
CREATE UNIQUE INDEX "PlatformOperator_email_key" ON "PlatformOperator"("email");

-- 20261003164500_platform_operator
-- CreateIndex
-- Serves "every active operator whose lock has lapsed", which would otherwise be
-- a sequential scan of the whole table on every administrative pass. `status`
-- leads so the sweep's own `status = 'ACTIVE'` predicate is the first column
-- compared. Deliberately not a partial index — Prisma cannot express one.
CREATE INDEX "PlatformOperator_status_lockedUntil_idx" ON "PlatformOperator"("status", "lockedUntil");

-- 20261003164500_platform_operator
-- AddForeignKey
-- SET NULL, not CASCADE and not RESTRICT: the audit trail must outlive the
-- person it describes. Deleting an operator detaches their entries rather than
-- deleting them, so "what did this account do" survives its removal — which is
-- the whole reason the column exists. Matches the optional-relation treatment
-- used by PasskeyChallenge_userId_fkey in 20261002103000_platform_config.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "PlatformOperator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
