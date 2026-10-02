-- Platform configuration, passkey auth, and account hardening.
--
-- Adds:
--   * UserStatus enum          — account lifecycle states (Phase 4.1)
--   * User hardening columns   — lockout, 2FA, status, verify tokens (Phase 4.1)
--   * AuditLog hash chain      — description/hash/previousHash (Phase 0)
--   * Passkey tables           — WebAuthn credentials and challenges (Phase 4.2)
--   * SystemConfig             — per-tenant feature flag overrides (Phase 4.3)
--   * SystemError / LogEntry   — platform error and log capture (Phase 4.3)
--   * ErrorSeverity / LogLevel enums
--
-- DEPLOYMENT NOTE — read before running this file:
-- This database has no `_prisma_migrations` ledger; the live schema was built
-- with `prisma db push`. `20260929000000_init` is therefore NOT applied, and
-- running `prisma migrate deploy` would fail partway through init and leave a
-- corrupt ledger. Until `tools/migrate baseline` reconciles the history (see
-- docs/technical/2026-10-01_000000-build-plan-tools-migrate.md), apply schema
-- changes with `prisma db push`, which is diff-based and idempotent.
--
-- This migration is purely additive — no DROPs and no column type changes, and
-- every new NOT NULL column carries a DEFAULT, so it is safe against a
-- database that already contains rows.
--
-- One exception to "safe against existing rows": the two foreign keys added at
-- the end do validate them. They require every `SystemConfig.tenantId` and
-- `SystemError.tenantId` to match an existing `Tenant.id`, and both are created
-- with no rows, so this only bites a database that already carries orphaned
-- rows from a tenant deleted outside the schema. Clear them first:
--   DELETE FROM "SystemConfig" WHERE "tenantId" NOT IN (SELECT id FROM "Tenant");
--   DELETE FROM "SystemError"  WHERE "tenantId" NOT IN (SELECT id FROM "Tenant");

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "ErrorSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "description" TEXT,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "previousHash" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "loginAttempts" INTEGER DEFAULT 0,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passkeyBridgeExpires" TIMESTAMP(3),
ADD COLUMN     "passkeyBridgeToken" TEXT,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "settings" JSONB,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorSecret" TEXT,
ADD COLUMN     "verifyToken" TEXT,
ADD COLUMN     "verifyTokenExpires" TIMESTAMP(3);

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

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "PasskeyChallenge_challenge_key" ON "PasskeyChallenge"("challenge");

-- CreateIndex
CREATE INDEX "PasskeyChallenge_expiresAt_idx" ON "PasskeyChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "SystemConfig_tenantId_category_idx" ON "SystemConfig"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_tenantId_key_key" ON "SystemConfig"("tenantId", "key");

-- CreateIndex
CREATE INDEX "SystemError_tenantId_severity_createdAt_idx" ON "SystemError"("tenantId", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "SystemError_tenantId_resolved_createdAt_idx" ON "SystemError"("tenantId", "resolved", "createdAt");

-- CreateIndex
CREATE INDEX "LogEntry_level_createdAt_idx" ON "LogEntry"("level", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_passkeyBridgeToken_key" ON "User"("passkeyBridgeToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_verifyToken_key" ON "User"("verifyToken");

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasskeyChallenge" ADD CONSTRAINT "PasskeyChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemError" ADD CONSTRAINT "SystemError_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemError" ADD CONSTRAINT "SystemError_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- The last two constraints are the tenant relations the 28 models in
-- 20260929000000_init already declare: without them SystemConfig and
-- SystemError held a bare tenantId, so orphaned rows survived a tenant
-- deletion. RESTRICT matches that migration's ON DELETE action for every
-- required tenant relation. Unlike the statements above, these two validate
-- existing rows, so a database that already carries orphans for a deleted
-- tenant will fail here until they are cleared.
ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemError" ADD CONSTRAINT "SystemError_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
