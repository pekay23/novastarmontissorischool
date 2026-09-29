-- Tenant isolation via PostgreSQL Row Level Security.
-- Tenant id is a cuid() string, not a uuid: compare as text.
--
-- ---------------------------------------------------------------------------
-- NOT SAFE TO APPLY AS-IS. Read this before running.
--
-- This file is deliberately NOT in prisma/migrations/, so `prisma migrate
-- deploy` will not pick it up. Applying it today would take down all 51
-- tables, because:
--
--   packages/database/index.ts uses PrismaNeon (@prisma/adapter-neon), the
--   Neon serverless HTTP driver. That driver is stateless: every query is a
--   separate HTTP request to a pooled endpoint, so there is no session to
--   hang `SET app.current_tenant_id` on. current_setting() therefore always
--   returns NULL, every policy evaluates false, and all reads and writes
--   return zero rows.
--
-- To make this applicable, one of these must happen first:
--
--   1. Switch to a stateful driver (PrismaPg / node-postgres / the Neon
--      WebSocket driver) and set app.current_tenant_id per connection inside
--      a transaction, or
--   2. Keep the HTTP driver and wrap each tenant-scoped unit of work in
--      prisma.$transaction(async tx => { await tx.$executeRaw`SELECT
--      set_config('app.current_tenant_id', ${tenantId}, true)`; ... }),
--      so the setting is scoped to the transaction rather than the session.
--
-- Until then tenant isolation is enforced in application code only, via
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

