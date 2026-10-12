-- Failsafe parity DDL: brings the Supabase failsafe up to the primary's
-- table set so tools/migrate's require-backup guard stops refusing writes.
--
-- Missing tables at generation time (2): StudentHealthDocument, NewsletterSubscription
-- Missing enums at generation time (0)
--
-- Generated from packages/database/prisma/migrations by gen-parity-ddl.ts.
-- ONE-SHOT, applied atomically by tools/db-mirror/apply-schema.ts.
--
-- A table already present on the failsafe MUST be removed from TABLES before
-- regenerating: these are plain CREATEs, so a repeat apply fails as a whole.
-- The count above is derived from the list precisely so it cannot disagree
-- with it.

-- 20261005145130_add_student_health
-- CreateTable
CREATE TABLE "StudentHealthDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "supersedesId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentHealthDocument_pkey" PRIMARY KEY ("id")
);

-- 20261005145130_add_student_health
-- CreateIndex
CREATE UNIQUE INDEX "StudentHealthDocument_storageKey_key" ON "StudentHealthDocument"("storageKey");

-- 20261005145130_add_student_health
-- CreateIndex
CREATE INDEX "StudentHealthDocument_tenantId_studentId_idx" ON "StudentHealthDocument"("tenantId", "studentId");

-- 20261005145130_add_student_health
-- CreateIndex
CREATE INDEX "StudentHealthDocument_tenantId_studentId_uploadedAt_idx" ON "StudentHealthDocument"("tenantId", "studentId", "uploadedAt");

-- 20261005145130_add_student_health
-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261005145130_add_student_health
-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261005145130_add_student_health
-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261005145130_add_student_health
-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "StudentHealthDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 20261005145130_add_student_health
-- AddForeignKey
ALTER TABLE "StudentHealthDocument" ADD CONSTRAINT "StudentHealthDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 20261011224609_newsletter_single_school
-- CreateTable
CREATE TABLE "NewsletterSubscription" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'website',
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSubscription_pkey" PRIMARY KEY ("id")
);

-- 20261011224609_newsletter_single_school
-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscription_email_key" ON "NewsletterSubscription"("email");
