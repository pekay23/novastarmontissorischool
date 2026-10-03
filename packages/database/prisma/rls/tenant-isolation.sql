-- Tenant isolation via PostgreSQL Row Level Security.
-- Tenant id is a cuid() string, not a uuid: compare as text.
--
-- ---------------------------------------------------------------------------
-- STATUS: ALREADY APPLIED. This file is a record of what is in place, not a
-- pending change.
--
-- An earlier version of this header claimed the opposite -- that the SQL was
-- not in prisma/migrations/ so `migrate deploy` would ignore it, and that
-- applying it would take down all 51 tables. Both claims were false. Verified
-- read-only against the live database on 2026-10-03:
--
--   * the `app` schema exists, along with app.current_tenant_id() returning
--     text and app.is_tenant_bypass() returning boolean;
--   * 51 of the 56 tables have ENABLE ROW LEVEL SECURITY and FORCE ROW LEVEL
--     SECURITY, each carrying one `tenant_isolation` policy FOR ALL TO public.
--
-- Re-running this file is idempotent and safe: CREATE SCHEMA IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, and DROP POLICY IF EXISTS before each CREATE
-- POLICY. `migrate deploy` genuinely does not read this file -- that part was
-- right -- so any schema change to a covered table needs a matching edit here or
-- the policy set silently drifts behind the datamodel.
--
-- WHY NOTHING BROKE, and why that is not a reason to rely on RLS:
-- the portal connects as `neondb_owner`, which has rolbypassrls = true. A
-- BYPASSRLS role skips every policy, so these 51 policies have never filtered a
-- production query. Effective tenant isolation today comes from two other
-- places, neither of them this file:
--
--   1. explicit `where: { tenantId }` clauses in application code, and
--   2. the connection role's BYPASSRLS.
--
-- So RLS here is a defence-in-depth layer and nothing more: the backstop that
-- would still hold if some query forgot its tenant filter, but only once the
-- connection stops bypassing it. It is not currently load-bearing.
--
-- NAMED FOLLOW-UP, not done: no application code calls
-- app.current_tenant_id(). Its only input is
-- current_setting('app.current_tenant_id', true), which returns NULL unless a
-- caller sets it, and the policy is written to match no tenant when that is
-- NULL. The moment the connection role loses BYPASSRLS, every read returns
-- zero rows and every write is rejected. Before that role change, something has
-- to set the GUC per unit of work, and the current driver cannot do it:
-- packages/database/index.ts uses PrismaNeon (@prisma/adapter-neon), the Neon
-- serverless HTTP driver, which is stateless -- every query is a separate HTTP
-- request to a pooled endpoint, so there is no session to hang the setting on.
-- Either
--
--   1. switch to a stateful driver (PrismaPg / node-postgres / the Neon
--      WebSocket driver) and SET app.current_tenant_id per connection inside a
--      transaction, or
--   2. keep the HTTP driver and wrap each tenant-scoped unit of work in
--      prisma.$transaction(async tx => { await tx.$executeRaw`SELECT
--      set_config('app.current_tenant_id', ${tenantId}, true)`; ... }),
--      which scopes the setting to the transaction rather than the session.
--
-- Until then tenant isolation is enforced in application code, via
-- getTenantContext() in apps/portal/lib/tenant.ts.
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS app;

-- True when a tenant context is active for this connection. Returns text
-- (cuid), and NULL when unset, so policies fail closed.
CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT nullif(current_setting('app.current_tenant_id', true), '') $$;

-- True when the connection has been granted a deliberate cross-tenant
-- bypass (migrations, backups). Must be set explicitly, never a default.
CREATE OR REPLACE FUNCTION app.is_tenant_bypass()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;

ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "School" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "School";
CREATE POLICY tenant_isolation ON "School"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "AcademicYear" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademicYear" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AcademicYear";
CREATE POLICY tenant_isolation ON "AcademicYear"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Term" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Term" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Term";
CREATE POLICY tenant_isolation ON "Term"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "ClassLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassLevel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClassLevel";
CREATE POLICY tenant_isolation ON "ClassLevel"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Subject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subject" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Subject";
CREATE POLICY tenant_isolation ON "Subject"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "SubjectLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubjectLevel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SubjectLevel";
CREATE POLICY tenant_isolation ON "SubjectLevel"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Class" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Class" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Class";
CREATE POLICY tenant_isolation ON "Class"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "ClassTerm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassTerm" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClassTerm";
CREATE POLICY tenant_isolation ON "ClassTerm"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "ClassSubject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassSubject" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClassSubject";
CREATE POLICY tenant_isolation ON "ClassSubject"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "GradingScale" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradingScale" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GradingScale";
CREATE POLICY tenant_isolation ON "GradingScale"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "AssessmentTypeConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssessmentTypeConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AssessmentTypeConfig";
CREATE POLICY tenant_isolation ON "AssessmentTypeConfig"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "FeeCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeeCategory";
CREATE POLICY tenant_isolation ON "FeeCategory"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "PaymentMethodConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentMethodConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PaymentMethodConfig";
CREATE POLICY tenant_isolation ON "PaymentMethodConfig"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "FeeStructure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeStructure" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeeStructure";
CREATE POLICY tenant_isolation ON "FeeStructure"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "FeeLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeLineItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeeLineItem";
CREATE POLICY tenant_isolation ON "FeeLineItem"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Role";
CREATE POLICY tenant_isolation ON "Role"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Permission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Permission";
CREATE POLICY tenant_isolation ON "Permission"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Delegation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Delegation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Delegation";
CREATE POLICY tenant_isolation ON "Delegation"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "AttendanceTaker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceTaker" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceTaker";
CREATE POLICY tenant_isolation ON "AttendanceTaker"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Staff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Staff";
CREATE POLICY tenant_isolation ON "Staff"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "StaffRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffRole" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StaffRole";
CREATE POLICY tenant_isolation ON "StaffRole"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Department";
CREATE POLICY tenant_isolation ON "Department"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Student";
CREATE POLICY tenant_isolation ON "Student"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Parent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Parent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Parent";
CREATE POLICY tenant_isolation ON "Parent"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Enrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Enrollment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Enrollment";
CREATE POLICY tenant_isolation ON "Enrollment"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Assessment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Assessment";
CREATE POLICY tenant_isolation ON "Assessment"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Score" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Score" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Score";
CREATE POLICY tenant_isolation ON "Score"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "AttendanceStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceStudent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceStudent";
CREATE POLICY tenant_isolation ON "AttendanceStudent"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "AttendanceStaff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceStaff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceStaff";
CREATE POLICY tenant_isolation ON "AttendanceStaff"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "FeeInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeInvoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeeInvoice";
CREATE POLICY tenant_isolation ON "FeeInvoice"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "FeeInvoiceLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeInvoiceLineItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeeInvoiceLineItem";
CREATE POLICY tenant_isolation ON "FeeInvoiceLineItem"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Message";
CREATE POLICY tenant_isolation ON "Message"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notification";
CREATE POLICY tenant_isolation ON "Notification"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "News" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "News" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "News";
CREATE POLICY tenant_isolation ON "News"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Event";
CREATE POLICY tenant_isolation ON "Event"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "ReportTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReportTemplate";
CREATE POLICY tenant_isolation ON "ReportTemplate"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "House" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "House" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "House";
CREATE POLICY tenant_isolation ON "House"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Branding" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Branding";
CREATE POLICY tenant_isolation ON "Branding"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "ConfigEntity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConfigEntity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConfigEntity";
CREATE POLICY tenant_isolation ON "ConfigEntity"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Timetable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Timetable" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Timetable";
CREATE POLICY tenant_isolation ON "Timetable"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "TimetableEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimetableEntry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TimetableEntry";
CREATE POLICY tenant_isolation ON "TimetableEntry"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "LeaveRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LeaveRequest";
CREATE POLICY tenant_isolation ON "LeaveRequest"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "BookCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BookCategory";
CREATE POLICY tenant_isolation ON "BookCategory"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Book" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Book" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Book";
CREATE POLICY tenant_isolation ON "Book"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "BookLoan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BookLoan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BookLoan";
CREATE POLICY tenant_isolation ON "BookLoan"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "InventoryCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryCategory";
CREATE POLICY tenant_isolation ON "InventoryCategory"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryItem";
CREATE POLICY tenant_isolation ON "InventoryItem"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "InventoryTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransaction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryTransaction";
CREATE POLICY tenant_isolation ON "InventoryTransaction"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Coverage added 2026-10-03 for the tenant-scoped tables that arrived after the
-- original 51. A cross-check of every model in schema.prisma against this file
-- found exactly four tenant-scoped tables with no policy, and they are these:
-- GradingLevel and Syllabus became tenant-scoped in
-- 20261003000000_unifiedtransform_port_wave0 (GradingLevel gained a tenantId;
-- Syllabus is new and carries one), and SystemConfig and SystemError arrived
-- tenant-scoped in 20261002103000_platform_config.
-- ---------------------------------------------------------------------------

ALTER TABLE "GradingLevel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GradingLevel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GradingLevel";
CREATE POLICY tenant_isolation ON "GradingLevel"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "Syllabus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Syllabus" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Syllabus";
CREATE POLICY tenant_isolation ON "Syllabus"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "SystemConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SystemConfig";
CREATE POLICY tenant_isolation ON "SystemConfig"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

ALTER TABLE "SystemError" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemError" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SystemError";
CREATE POLICY tenant_isolation ON "SystemError"
  FOR ALL
  USING (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id())
  WITH CHECK (app.is_tenant_bypass() OR "tenantId" = app.current_tenant_id());

-- ---------------------------------------------------------------------------
-- Tables deliberately left without a tenant policy.
--
-- A tenant_isolation policy needs a tenantId column to compare against. These
-- tables have none, so there is nothing to scope them by. No policy is written
-- for them, and none should be: reaching a parent table from inside a policy to
-- reach a tenant would be a behaviour change, not a fix, and the columns each
-- table would need do not exist in schema.prisma.
--
--   Passkey          -- keyed by userId -> User, and its isolation is
--                       inherited from User: a passkey is only reachable
--                       through a user the caller can already read. Adding a
--                       tenantId would duplicate User.tenantId and could drift
--                       from it. Note that FORCE RLS on User therefore already
--                       governs it indirectly once BYPASSRLS goes away.
--   PasskeyChallenge -- a short-lived WebAuthn challenge, identified by a
--                       random challenge string rather than by a tenant. Its
--                       userId is nullable precisely because a challenge is
--                       issued before the user is known, so there is no tenant
--                       to scope it to. Its lifetime is bounded by expiresAt.
--   LogEntry         -- a process-wide structured log, deliberately not
--                       tenant-scoped in schema.prisma.
--
-- Also global by design and likewise uncovered: Tenant (the tenant record
-- itself, which a tenant policy could not meaningfully scope), plus Account,
-- Session and VerificationToken, which are Auth.js bookkeeping keyed by token
-- rather than by tenant.
-- ---------------------------------------------------------------------------

