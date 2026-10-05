-- The per-field amendment trail.
--
-- Adds:
--   * RecordAmendment — one row per changed field, append-only, grouped by a
--                       writer-minted groupId, tagged old/new values
--   * four CHECK constraints — a trail row cannot be anonymous, ungrouped,
--                        unreasoned, or name two actors
--   * four indexes — entity history, school-period report, per-actor, per-group
--   * two SET NULL foreign keys — to User and to PlatformOperator
--   * REVOKE UPDATE, DELETE — append-only is the guarantee worth stating in DDL
--
-- WHY THIS IS A NEW TABLE AND NOT AN `AuditLog` EXTENSION
-- -------------------------------------------------------
-- `AuditLog` is the obvious home and was rejected for three reasons that only
-- bite at one-row-per-field grain:
--
--   1. It is hash-chained per tenant (`previousHash`/`hash`), so every row
--      extends one tenant-wide tail. A single register correction is roughly 100
--      field rows, which would serialise every amendment in a school against
--      that one tail.
--   2. Verifying the chain is O(all rows in the tenant). Auth-event retention and
--      per-child-per-term retention are different lifetimes; chaining them means
--      neither can be pruned without destroying the other's proof.
--   3. `AuditLog.oldData`/`newData` are whole-record JSON. One of those per
--      changed field is quadratic in the field count and leaves the reader
--      computing a diff to learn which field actually moved.
--
-- WHY NOT ONE TABLE PER ENTITY
-- ---------------------------
-- The grain is a value, not a record, so a single entity-agnostic table is the
-- whole design: a new amendable entity becomes a value of `entity`, not a
-- migration plus a pair of back-relations plus grants.
--
-- WHY `groupId` IS NOT NULL WITH NO DEFAULT
-- ------------------------------------------
-- This is load-bearing, so it is stated here as well as in schema.prisma. A
-- `@default(cuid())` would give every row a DIFFERENT value and group nothing,
-- and that is the worst failure available: the column would look like it works.
-- With no default, every writer must mint one id and pass it to every field row
-- of the same logical edit, so a three-field student correction is ONE group
-- with ONE reason rather than three unrelated entries with three unrelated
-- reasons. The CHECK below exists because an empty string would defeat that
-- grouping just as silently as a default would.
--
-- WHY THE CHECKS LIVE HERE AND NOT IN schema.prisma
-- -------------------------------------------------
-- Prisma cannot express a CHECK constraint, so these four exist only in this
-- file and `prisma migrate diff` will not reproduce them from the datamodel.
-- That is accepted, not overlooked: `reason` and `field` are NOT NULL in the
-- schema and that is not sufficient, because `''` satisfies NOT NULL perfectly
-- well. A reason of `''` is the exact failure the trail exists to prevent — an
-- unattributable edit wearing the costume of a justified one.
--
-- The emptiness tests use `btrim(...) <> ''`, not `... <> ''`, so a reason of
-- `'   '` is refused too. `btrim(text)` is immutable, so it is legal here.
--
-- The exactly-one-actor test mirrors the reasoning already recorded at
-- `AuditLog.operatorId`: an operator has no `User` row (`User.tenantId` is
-- non-null and an operator belongs to no tenant), so there is no correct `User`
-- to point at. Pointing `userId` at the nearest school administrator would be
-- worse than NULL — it would attribute a cross-tenant action to a tenant member
-- who did not perform it. Hence two sibling columns, exactly one of which is
-- named: `num_nonnulls(...) = 1` makes "neither" and "both" unrepresentable
-- rather than merely discouraged.
--
-- READ THIS ONE: this CHECK and the `ON DELETE SET NULL` on the two actor
-- foreign keys contradict each other, and the CHECK wins. SET NULL is an UPDATE
-- of the referencing row, CHECK runs on every UPDATE, so deleting a user who has
-- ever amended anything is REJECTED. The full consequence and the three ways to
-- resolve it are written out at RecordAmendment_userId_fkey below.
--
-- WHY NOT HASH-CHAINED
-- --------------------
-- Integrity comes from three cheaper guarantees: append-only privileges (below),
-- the amendment row being written in the SAME transaction as the edit it
-- describes, and the CHECKs. A chain would add a write-time lock to a table that
-- has to accept the correction even when something else has already gone wrong.
--
-- WHAT THE REVOKE DOES AND DOES NOT DO — read this before relying on it
-- ---------------------------------------------------------------------
-- `REVOKE ... FROM PUBLIC` strips the default grant, so the table reaches a
-- fresh role with INSERT only. That is worth having as a standing statement of
-- intent: it survives a future `ALTER DEFAULT PRIVILEGES ... GRANT ALL`, which
-- would otherwise hand every future table UPDATE and DELETE to every role and
-- quietly make the whole trail rewritable.
--
-- It is NOT, by itself, append-only enforcement, and this file does not claim it
-- is. An owner retains implicit UPDATE and DELETE regardless of any REVOKE, and
-- per prisma/rls/tenant-isolation.sql the portal connects as `neondb_owner`,
-- i.e. the owner. What genuinely binds is the write path: amendments are
-- inserted inside the same transaction as the edit and nothing in the codebase
-- issues an UPDATE or DELETE against this table. A BEFORE UPDATE OR DELETE
-- trigger would bind the owner as well, and is the upgrade if this ever has to
-- survive a code path that deletes rows — deliberately not added here, because
-- it also makes a lawful erasure request (a child who left) impossible to
-- satisfy without an owner-defined bypass.
--
-- STATUS: WRITTEN BUT NOT APPLIED. Nothing in this file has been executed
-- against any database by its author. Check the live ledger state with
-- `bun run db:migrate:status` and `bun run db:migrate:verify` from the repo root
-- rather than assuming either answer.
--
-- DEPLOYMENT NOTE — read before running anything:
-- This database was provisioned by `prisma db push` / `db execute`, neither of
-- which writes `_prisma_migrations`, so the ledger's contents must be confirmed
-- rather than assumed. Until `tools/migrate baseline` has run and
-- `db:migrate:verify` is green, apply schema changes with `prisma db push`,
-- which is diff-based and idempotent. See the identical note in
-- 20261003164500_platform_operator for the longer version.
--
-- ORDERING DEPENDENCY, outside this file: `tools/migrate/commands/deploy.ts`
-- asserts backup parity BEFORE it runs `migrate deploy`, and
-- `require-backup.ts` refuses when the failsafe lacks a table the primary has.
-- Two new tables here therefore abort the guarded deploy at that check unless
-- `tools/db-mirror/failsafe-parity.sql` is regenerated with
-- `gen-parity-ddl.ts` and applied to the failsafe first. That is an ordering
-- constraint, not a risk: regenerate parity, apply parity, then migrate.
--
-- This migration is additive: no DROP, no column type change, no backfill. Every
-- NOT NULL column it adds belongs to a table this same file creates, so there is
-- no pre-existing row for any constraint to be validated against and nothing to
-- be applied against.
--
-- The trail therefore STARTS EMPTY, and is never backfilled. Absence of a row is
-- not evidence that a value was never corrected. schema.prisma records why, in
-- full, and the short form is: the attendance correction path overwrites
-- `markedById` with the correcting user and no attendance route calls the audit
-- logger, so the pre-deployment corrections are unrecoverable rather than merely
-- unrecorded.

-- CreateTable
CREATE TABLE "RecordAmendment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    -- Nullable where `AuditLog.schoolId` is NOT NULL, because a cross-tenant
    -- operator action has no school to name. That is the truth about such a row,
    -- so the column records it rather than forcing a plausible-looking school.
    "schoolId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    -- No DEFAULT, on purpose. See the header.
    "groupId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    -- SQL NULL on `oldValue` means INSERT and nothing else; a SQL NULL *value*
    -- is the tagged envelope {"kind":"null"}, and "not part of this change" is
    -- an absent key. See the envelope table in schema.prisma.
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "operatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordAmendment_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- The four CHECKs Prisma cannot express. Added as ALTER rather than inline in
-- the CREATE TABLE so the reason for each sits next to it; all four are verified
-- against zero rows, since the table is created empty above.
ALTER TABLE "RecordAmendment"
    ADD CONSTRAINT "RecordAmendment_field_nonempty_check"
    CHECK (btrim("field") <> '');

ALTER TABLE "RecordAmendment"
    ADD CONSTRAINT "RecordAmendment_reason_nonempty_check"
    CHECK (btrim("reason") <> '');

-- The fourth CHECK, and the reason it is `groupId` specifically: the entire
-- design rests on one writer-minted id tying a multi-field edit together, and an
-- empty string would group every fieldless edit under one silent bucket exactly
-- as thoroughly as a cuid() default would. `entity` and `entityId` are left to
-- NOT NULL because, unlike `groupId`, an empty value there fails to select a
-- single row's history and so cannot quietly merge unrelated records.
ALTER TABLE "RecordAmendment"
    ADD CONSTRAINT "RecordAmendment_groupId_nonempty_check"
    CHECK (btrim("groupId") <> '');

-- Exactly one actor. `num_nonnulls` counts non-NULL arguments, so this reads
-- directly as "one of these two, never both, never neither".
ALTER TABLE "RecordAmendment"
    ADD CONSTRAINT "RecordAmendment_exactly_one_actor_check"
    CHECK (num_nonnulls("userId", "operatorId") = 1);

-- CreateIndex
-- "Every amendment ever made to this record" — the question a disputed value
-- actually asks. `createdAt` trails so a reader does not sort by hand.
CREATE INDEX "RecordAmendment_tenantId_entity_entityId_createdAt_idx" ON "RecordAmendment"("tenantId", "entity", "entityId", "createdAt");

-- CreateIndex
-- "Everything changed in this school in this period" — the register-wide report.
-- Separate from the index above because it names no entity.
CREATE INDEX "RecordAmendment_tenantId_schoolId_createdAt_idx" ON "RecordAmendment"("tenantId", "schoolId", "createdAt");

-- CreateIndex
-- "Everything this account amended", mirroring AuditLog_operatorId_idx, which is
-- the reason that index exists.
CREATE INDEX "RecordAmendment_userId_createdAt_idx" ON "RecordAmendment"("userId", "createdAt");

-- CreateIndex
-- Serves the reverse lookup from a group back to its field rows, which is how one
-- edit is read as one edit. Without it, reading a single group is a sequential
-- scan of the whole table — the same O(all rows) property that disqualified
-- AuditLog for this job would then apply to the replacement.
CREATE INDEX "RecordAmendment_groupId_idx" ON "RecordAmendment"("groupId");

-- AddForeignKey
-- ON DELETE SET NULL is specified for both actor FKs, matching
-- AuditLog_operatorId_fkey in 20261003164500_platform_operator. But note what the
-- interaction with the CHECK above actually does, because the two requirements are
-- in tension and the CHECK wins:
--
--   `ON DELETE SET NULL` is implemented as an UPDATE of the referencing row, and a
--   CHECK constraint is evaluated on every UPDATE. Deleting a User who has ever
--   amended a record therefore sets `userId` to NULL, `num_nonnulls` drops to 0,
--   and the DELETE is REJECTED by RecordAmendment_exactly_one_actor_check. The
--   same applies to `operatorId`.
--
-- So these two clauses are not "the trail outlives the person because SET NULL
-- detaches the rows". In practice the trail outlives the person because the
-- person's DELETION IS REFUSED: an account that made a recorded amendment cannot
-- be removed while the amendment stands. `SET NULL` on these two columns is
-- unreachable while that CHECK exists.
--
-- That is arguably the more honest outcome for an append-only evidence trail —
-- deleting an actor would erase the attribution of every change they made, which
-- is the one thing this table must never permit — and it is what a reader of the
-- schema should assume. It is not, however, what "SET NULL" normally signals, so
-- it is written down here rather than left to be discovered by a failed DELETE in
-- production.
--
-- The three mutually exclusive ways to resolve it, for whoever owns the decision:
--
--   1. Keep exactly this. Deletion of an actor with amendments is refused.
--      Correct for evidence; needs a documented support path for "remove this
--      former employee" that does not involve deleting amendments.
--   2. Relax the CHECK to `num_nonnulls("userId","operatorId") <= 1`. Then SET
--      NULL works as written and a deleted actor leaves anonymous amendments —
--      the same trade AuditLog already makes, since it has no actor CHECK at all.
--      Weakens "a row always names somebody" to "a row never names two people".
--   3. Drop the CHECK and keep SET NULL, as AuditLog does.
--
-- Option 1 is what this migration ships, because the CHECK is the requirement
-- that makes an unattributed, unreasoned amendment unrepresentable, and that is
-- worth more here than the ability to delete an employee record.
ALTER TABLE "RecordAmendment" ADD CONSTRAINT "RecordAmendment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
-- A platform operator belongs to no tenant and has no `User` row, so this column
-- is the only way a cross-tenant correction is attributable to a person. It is
-- subject to the same tension described above: SET NULL is unreachable while
-- RecordAmendment_exactly_one_actor_check exists, and an operator who has amended
-- a record cannot be deleted.
ALTER TABLE "RecordAmendment" ADD CONSTRAINT "RecordAmendment_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "PlatformOperator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- REVOKE UPDATE, DELETE — see the header for exactly what this does and does not
-- guarantee. The reason to want it at all: a trail that can be quietly rewritten
-- launders the very change it exists to expose, which is strictly worse than
-- having no trail, because a reader would then have positive evidence of an
-- honest history that was manufactured.
REVOKE UPDATE, DELETE ON "RecordAmendment" FROM PUBLIC;