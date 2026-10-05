-- Reason-gated locks, and an internal announcements table.
--
-- Adds:
--   * Student.finalizedAt / finalizedById
--   * Parent.finalizedAt / finalizedById
--   * AttendanceStudent.finalizedAt / finalizedById
--   * AttendanceStaff.finalizedAt / finalizedById
--   * Announcement + AnnouncementStatus — staff-only notices, off the public CMS
--
-- WHAT "LOCKED" MEANS HERE
-- ----------------------
-- Locked means "cannot be edited SILENTLY", not "cannot be edited". A locked row
-- is still editable; the edit just has to carry a reason, which lands in
-- RecordAmendment from 20261004170000. A true immutability flag would convert a
-- data-entry mistake into a support escalation, and a school would rather amend a
-- child's record with a written reason attached than be told the system refuses.
-- Unlocking is clearing the two columns.
--
-- THE FOUR MODELS, AND THE TWO DELIBERATELY LEFT ALONE
-- -----------------------------------------------------
-- These four had no existing lock column, so the pair is new:
--   * Student              — a register entry is what a parent disputes
--   * Parent               — contact details are the most-corrected fields here
--   * AttendanceStudent    — the record most likely to be disputed after the fact
--   * AttendanceStaff      — as AttendanceStudent
--
-- Score is NOT given these columns. It already carries `isApproved`,
-- `approvedById` and `approvedAt`, which is semantically identical to
-- `finalizedAt`/`finalizedById` and already includes the timestamp. A second
-- pair there would be the same meaning twice, which is precisely the stale-schema
-- trap this schema already suffers from elsewhere — two columns to keep in step
-- and disagree. The client asked for `isApproved` to be used, so it is used.
--
-- Assessment is NOT given a column either. `isPublished`/`publishedAt` already
-- ARE its lock and have been all along. The defect there is a write path, not a
-- schema: `POST /api/assessments/[id]/scores` never checks
-- `assessment.isPublished`, so an assessment can be published and then have its
-- marks edited. That is a route fix and belongs to whoever owns the route.
--
-- WHY `Announcement` IS NOT MORE `News`
-- ------------------------------------
-- `News` is the public marketing CMS. `apps/public-site/lib/data.ts` renders it,
-- filtered on nothing but `status: 'PUBLISHED'`, and it is read at BUILD time by
-- an `output: 'export'` app. `POST /api/announcements` nonetheless writes staff
-- notices there, so an internal notice addressed to one classroom teacher is one
-- `status` flip away from appearing on the school's public homepage.
--
-- `News.audience` already exists and is not a containment boundary: nothing on
-- the public path reads it, so it selects nothing there. Hence separate storage,
-- not a shared table with a flag.
--
-- WHY `AnnouncementStatus` IS NOT `ContentStatus`
-- ----------------------------------------------
-- `ContentStatus` holds the same three values and reusing it would have been less
-- code. It is declared separately because this table's lifecycle is set by a
-- school administrator and is not part of the public publishing workflow: sharing
-- a type would mean a change to how the marketing CMS is moderated could silently
-- change what states an internal notice can be in. The cost is one additional
-- Postgres enum type, which is a smaller problem than a cross-coupling.
--
-- WHY `tenantId`/`schoolId` ARE PLAIN COLUMNS HERE
-- -------------------------------------------------
-- No relation, no back-relation on `Tenant` or `School`, matching `AuditLog` — the
-- closest sibling, and also an internal record. Every read of this table is scoped
-- by an explicit `where`. A Prisma relation would buy referential integrity the
-- rest of the internal-record surface does not have and would cost a write to
-- derive the school from the tenant.
--
-- STATUS: WRITTEN BUT NOT APPLIED. Nothing in this file has been executed
-- against any database by its author. Check the live ledger state with
-- `bun run db:migrate:status` and `bun run db:migrate:verify` from the repo root
-- rather than assuming either answer. The longer deployment note is in
-- 20261004170000_record_amendment_trail and in 20261003164500_platform_operator.
--
-- This migration is additive. Every one of the eight added columns is nullable
-- with no DEFAULT, so all four tables keep every row they have and every row
-- reads as unlocked. There is no DROP, no column type change, and no backfill —
-- nothing here needs to know anything about existing data to be applied safely.
--
-- The five foreign keys are added last, after the columns they reference. The four
-- lock FKs are nullable, so none of them can fail against existing rows: every
-- pre-existing row has a NULL `finalizedById`, which is a legal value.
-- `Announcement_authorId_fkey` is on a table this same file creates, so it also
-- has nothing to validate against.

-- CreateEnum
-- Declared before the table that uses it. The ordering of the whole file follows
-- the sequence `prisma migrate diff` emits — CreateEnum, AlterTable, CreateTable,
-- CreateIndex, AddForeignKey — so this file stays comparable against a generated
-- one.
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterTable
-- Eight columns, one statement each, so that a partially applied migration is
-- legible in the ledger's log rather than presenting as one opaque statement that
-- either landed or did not. Student and Parent first: the register, which is what
-- a school locks most often.
ALTER TABLE "Student" ADD COLUMN "finalizedAt" TIMESTAMP(3);
ALTER TABLE "Student" ADD COLUMN "finalizedById" TEXT;

ALTER TABLE "Parent" ADD COLUMN "finalizedAt" TIMESTAMP(3);
ALTER TABLE "Parent" ADD COLUMN "finalizedById" TEXT;

ALTER TABLE "AttendanceStudent" ADD COLUMN "finalizedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceStudent" ADD COLUMN "finalizedById" TEXT;

ALTER TABLE "AttendanceStaff" ADD COLUMN "finalizedAt" TIMESTAMP(3);
ALTER TABLE "AttendanceStaff" ADD COLUMN "finalizedById" TEXT;

-- CreateTable
-- `"audience" TEXT[]` carries no NOT NULL, and that is Prisma's own rendering of
-- a required scalar list rather than an omission here: 20260929000000_init emits
-- `Role.permissions` and `GradingScale.appliesToLevels` the same way. Rewriting it
-- as NOT NULL would make this file disagree with the diff `prisma migrate diff`
-- derives from schema.prisma, and that disagreement is drift.
--
-- What matters is that there is no DEFAULT, because a default here would be an
-- invented audience: `{}` would silently mean "nobody" and a notice would be
-- written that reaches no one. Empty means every role in the school, which is the
-- common case, and it is a value the writer must choose.
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT[],
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    -- Set when the notice goes live. Separate from `updatedAt` so "when was this
    -- first shown to staff" stays answerable after later edits.
    "publishedAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No DEFAULT, matching every other @updatedAt column in this chain: Prisma
    -- supplies it on every write, so a default was never needed and keeping one
    -- would make `migrate diff` report drift.
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Serves the one query this table exists for: the live notices a member of staff
-- in this school should see, newest first. `status` leads so that the reader's
-- own `status = 'PUBLISHED'` predicate is the leading column of the scan, and
-- `publishedAt` is in the index because ordering by it is not optional — a notice
-- list sorted by insertion is a notice list in the wrong order.
CREATE INDEX "Announcement_tenantId_schoolId_status_publishedAt_idx" ON "Announcement"("tenantId", "schoolId", "status", "publishedAt");

-- CreateIndex
-- Serves "everything this person wrote", mirroring AuditLog_operatorId_idx.
CREATE INDEX "Announcement_authorId_idx" ON "Announcement"("authorId");

-- AddForeignKey
-- Four locks, four nullable SET NULL foreign keys. Unlike RecordAmendment's actor
-- FKs, SET NULL genuinely works here: nothing constrains the finalized pair, so
-- deleting the user performs the UPDATE cleanly and the record simply loses the
-- name of who settled it while keeping `finalizedAt` and the lock.
--
-- CASCADE would be catastrophic rather than merely wrong — on a foreign key it
-- deletes the REFERENCING rows, so removing a teacher would delete every student,
-- parent and attendance record they had finalised. RESTRICT would make a user
-- undeletable for as long as they had finalised anything, which is a support
-- burden with no evidentiary benefit: a lock marker's job is to say "settled on
-- this date", and the date survives the name.
--
-- `ON UPDATE CASCADE` matches AuditLog_operatorId_fkey and the optional-relation
-- treatment used by PasskeyChallenge_userId_fkey in 20261002103000_platform_config.
ALTER TABLE "Student" ADD CONSTRAINT "Student_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Parent" ADD CONSTRAINT "Parent_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceStudent" ADD CONSTRAINT "AttendanceStudent_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceStaff" ADD CONSTRAINT "AttendanceStaff_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT, not SET NULL, and the contrast with the four above is the point of
-- this file rather than an inconsistency. `authorId` is NOT NULL: an announcement
-- with no author is an unattributed notice. SET NULL on a NOT NULL column is not
-- merely a different policy, it is a foreign key that ERRORS the moment the user
-- is deleted — the delete raises rather than silently dropping the constraint.
-- RESTRICT instead refuses the user deletion outright, which is the honest
-- outcome: you cannot remove the author of a notice that still stands.
--
-- This is Prisma's own default for a required relation and matches
-- News_authorId_fkey and Assessment_createdById_fkey in 20260929000000_init, so it
-- is also what `prisma migrate diff` derives from the datamodel.
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;