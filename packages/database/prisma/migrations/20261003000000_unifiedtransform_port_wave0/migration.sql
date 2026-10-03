-- Unifiedtransform port — foundation wave (Wave 0).
--
-- Adds:
--   * GradingLevel.tenantId     — the level becomes tenant-scoped like its parent
--   * GradingLevel uniques      — (gradingScaleId, key) and (gradingScaleId, order)
--   * Attendance period NOT NULL— makes the existing one-row-per-day unique real
--   * Syllabus table            — per-term topic lists
--   * ClassSubject teacher index— hot path for timetable + teacher workspace
--   * Assessment.weight NULL    — "unset" stops being a stored 1.00
--
-- NOT added, deliberately: `GradingLevel.point`. The column, and the 0-4 average
-- it fed, have been removed (see schema.prisma) — percentage is the unit of grading and
-- a 0-4 grade point has no place on a Ghanaian primary/JHS terminal report. Had
-- it shipped, every existing band would have carried the column default of 0.0
-- and read as "this child failed". Because this migration was never applied, no
-- database holds the column and no DROP or data backfill is needed.
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
-- Statement order is load-bearing in two places, both marked below: the
-- attendance backfill must precede its SET NOT NULL, and the GradingLevel
-- tenantId backfill must sit between ADD COLUMN and SET NOT NULL.
--
-- The two GradingLevel unique indexes are the only statements here that can fail
-- on a populated table, and only if a row already violates them. See the repair
-- queries printed inline; do not delete rows to make the index build.

-- AlterTable
-- Added nullable first. `tenantId` is NOT NULL in schema.prisma, but a NOT NULL
-- column cannot be added to a populated table without a default, and a synthetic
-- default would be a lie: a grade band's tenant is exactly its scale's tenant.
ALTER TABLE "GradingLevel" ADD COLUMN "tenantId" TEXT;

-- Backfill
-- Cannot leave rows unmatched: the `gradingScaleId` FK already guarantees every
-- level points at an existing scale, so the join is total. A row left NULL here
-- would fail the SET NOT NULL immediately below and name itself in the error.
UPDATE "GradingLevel" gl SET "tenantId" = gs."tenantId" FROM "GradingScale" gs WHERE gs."id" = gl."gradingScaleId";

-- AlterTable
ALTER TABLE "GradingLevel" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
-- Band lookup is first-match (`determineGrade` in packages/shared-utils uses
-- `Array.find`), so a duplicate key or a duplicate order position makes the
-- winning band a function of physical row order rather than of the score.
-- Without these two, two overlapping bands are creatable and the resulting grade
-- is silently arbitrary.
--
-- REPAIR BEFORE RUNNING if either CREATE UNIQUE INDEX fails, and only if it
-- fails. Inspect first:
--   -- duplicate keys within one scale:
--   SELECT "gradingScaleId", "key", COUNT(*), array_agg("id")
--     FROM "GradingLevel" GROUP BY 1,2 HAVING COUNT(*) > 1;
--   -- duplicate order positions within one scale:
--   SELECT "gradingScaleId", "order", COUNT(*), array_agg("id")
--     FROM "GradingLevel" GROUP BY 1,2 HAVING COUNT(*) > 1;
-- Then decide per duplicate which band survives: bands are not interchangeable,
-- so re-point `order` on the row you keep rather than deleting the other.
CREATE UNIQUE INDEX "GradingLevel_gradingScaleId_key_key" ON "GradingLevel"("gradingScaleId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "GradingLevel_gradingScaleId_order_key" ON "GradingLevel"("gradingScaleId", "order");

-- AddForeignKey
-- The Tenant back-relation the model now declares. RESTRICT matches the action
-- used by every required tenant relation in 20260929000000_init, so deleting a
-- tenant with grade bands is blocked rather than silently orphaning them.
-- Unlike the two indexes above this cannot fail: the backfill above guarantees
-- every tenantId resolves to a live Tenant, and the FK on gradingScaleId already
-- guarantees the scale — and therefore its tenant — exists.
ALTER TABLE "GradingLevel" ADD CONSTRAINT "GradingLevel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
-- ORDER MATTERS: backfill, then NOT NULL, then DEFAULT.
--
-- `AttendanceStudent` and `AttendanceStaff` both declare
-- @@unique([tenantId, studentId, date, period]) / @@unique([tenantId, staffId,
-- date, period]) while `period` was nullable. In PostgreSQL every NULL compares
-- unequal to every other NULL, so a row with a NULL period never collided with
-- anything: the unique index existed but enforced nothing, and re-saving the
-- same student/day inserted a duplicate row. '' is the whole-day sentinel.
--
-- Step 1 — replace every existing NULL with the sentinel. Must precede SET NOT
-- NULL; reversing the two fails the ALTER rather than being merely wrong.
UPDATE "AttendanceStudent" SET "period" = '' WHERE "period" IS NULL;

-- AlterTable
ALTER TABLE "AttendanceStudent" ALTER COLUMN "period" SET NOT NULL;

-- AlterTable
ALTER TABLE "AttendanceStudent" ALTER COLUMN "period" SET DEFAULT '';

-- AlterTable
-- Same defect, same three steps.
UPDATE "AttendanceStaff" SET "period" = '' WHERE "period" IS NULL;

-- AlterTable
ALTER TABLE "AttendanceStaff" ALTER COLUMN "period" SET NOT NULL;

-- AlterTable
ALTER TABLE "AttendanceStaff" ALTER COLUMN "period" SET DEFAULT '';

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

-- CreateIndex
-- One syllabus document per subject per term.
CREATE UNIQUE INDEX "Syllabus_tenantId_classSubjectId_termId_title_key" ON "Syllabus"("tenantId", "classSubjectId", "termId", "title");

-- CreateIndex
CREATE INDEX "Syllabus_tenantId_termId_idx" ON "Syllabus"("tenantId", "termId");

-- AddForeignKey
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Optional relation, so SET NULL: deleting a school must not delete the
-- syllabus, it must detach it. Matches GradingScale_schoolId_fkey in init.
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_classSubjectId_fkey" FOREIGN KEY ("classSubjectId") REFERENCES "ClassSubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Syllabus" ADD CONSTRAINT "Syllabus_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
-- The teacher workspace and the timetable both filter ClassSubject by teacher;
-- without this the query has no supporting index on the hot path.
CREATE INDEX "ClassSubject_tenantId_teacherId_idx" ON "ClassSubject"("tenantId", "teacherId");

-- AlterTable
-- `Assessment.weight` becomes nullable, and loses its default.
--
-- WHY: the column was `NOT NULL DEFAULT 1`, so "the teacher never set a weight"
-- and "the teacher explicitly set this assessment to weigh 1.00" were the same
-- stored value. `resolveAssessmentWeight` (@novastar/shared-utils) had to treat a
-- stored 1 as "unset" to let a type's configured weight reach a report at all,
-- which silently discarded a teacher's deliberate 1.00 — the school's own scheme
-- could not be honoured for one assessment. NULL now carries "unset" and 1.00
-- carries what it says, with no sentinel overloading either value.
--
-- ORDER: DROP DEFAULT first. `ALTER COLUMN ... DROP NOT NULL` and `DROP DEFAULT`
-- are independent, but a column that keeps `DEFAULT 1` would hand every insert
-- that omits `weight` — Prisma included — a 1 that means "explicit 1.00" again,
-- which is the bug this statement exists to remove.
ALTER TABLE "Assessment" ALTER COLUMN "weight" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Assessment" ALTER COLUMN "weight" DROP NOT NULL;

-- DATA CONSEQUENCE — READ BEFORE APPLYING, THIS ONE IS A JUDGEMENT CALL.
--
-- Dropping the default does not rewrite stored rows: every existing
-- `Assessment.weight` keeps whatever it holds. A row holding 1 becomes, from now
-- on, "explicitly 1.00" and stops inheriting its type's `defaultWeight`.
--
-- NO BACKFILL IS WRITTEN HERE, deliberately. A stored 1 is ambiguous in exactly
-- the way this migration removes the ambiguity for: it is either a row that
-- inherited the column default (never weighted deliberately) or a row whose
-- creator copied a type default of 1.00. Rewriting one to NULL and not the other
-- is a guess about grading history, and a wrong guess silently changes every
-- terminal percentage that row contributes to. That decision belongs to whoever
-- owns the data, with these queries:
--
--   -- what is actually stored:
--   SELECT "weight", COUNT(*) FROM "Assessment" GROUP BY 1 ORDER BY 1;
--   -- the rows this migration changes meaning for:
--   SELECT a."id", a."name", a."typeId", t."code", t."defaultWeight"
--     FROM "Assessment" a JOIN "AssessmentTypeConfig" t ON t."id" = a."typeId"
--    WHERE a."weight" = 1;
--   -- to restore inheritance for rows that never carried a deliberate weight:
--   UPDATE "Assessment" SET "weight" = NULL WHERE "weight" = 1;
--
-- The seed writes no `Assessment` rows at all — a school creates them — so there
-- is no seeded data to preserve and nothing to convert here.