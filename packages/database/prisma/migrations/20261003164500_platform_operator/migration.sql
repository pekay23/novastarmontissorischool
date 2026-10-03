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

-- CreateIndex
-- Two independent uniques, and the reason a login identifier can be either a
-- username or an email: each resolves to at most one operator on its own.
CREATE UNIQUE INDEX "PlatformOperator_username_key" ON "PlatformOperator"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformOperator_email_key" ON "PlatformOperator"("email");

-- CreateIndex
-- Serves "every active operator whose lock has lapsed", which would otherwise be
-- a sequential scan of the whole table on every administrative pass. `status`
-- leads so the sweep's own `status = 'ACTIVE'` predicate is the first column
-- compared. Deliberately not a partial index — Prisma cannot express one.
CREATE INDEX "PlatformOperator_status_lockedUntil_idx" ON "PlatformOperator"("status", "lockedUntil");

-- CreateIndex
CREATE INDEX "AuditLog_operatorId_idx" ON "AuditLog"("operatorId");

-- AddForeignKey
-- SET NULL, not CASCADE and not RESTRICT: the audit trail must outlive the
-- person it describes. Deleting an operator detaches their entries rather than
-- deleting them, so "what did this account do" survives its removal — which is
-- the whole reason the column exists. Matches the optional-relation treatment
-- used by PasskeyChallenge_userId_fkey in 20261002103000_platform_config.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "PlatformOperator"("id") ON DELETE SET NULL ON UPDATE CASCADE;