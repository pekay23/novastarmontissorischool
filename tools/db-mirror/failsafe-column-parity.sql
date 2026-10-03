-- Column-level parity DDL: adds columns present in the primary and absent
-- from the failsafe. Run AFTER failsafe-parity.sql (User.status needs the
-- "UserStatus" enum it creates) and BEFORE re-running tools/db-mirror/mirror.ts.
--
-- Generated from live information_schema by gen-column-parity-ddl.ts.
-- Verified with check-column-parity.ts.

ALTER TABLE "AuditLog" ADD COLUMN "description" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "previousHash" TEXT;
ALTER TABLE "GradingLevel" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "GradingLevel" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "loginAttempts" INTEGER DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN DEFAULT false;
ALTER TABLE "User" ADD COLUMN "passkeyBridgeExpires" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passkeyBridgeToken" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "settings" JSONB;
ALTER TABLE "User" ADD COLUMN "status" "UserStatus" DEFAULT 'ACTIVE'::"UserStatus";
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN DEFAULT false;
ALTER TABLE "User" ADD COLUMN "twoFactorSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "verifyToken" TEXT;
ALTER TABLE "User" ADD COLUMN "verifyTokenExpires" TIMESTAMP(3);
