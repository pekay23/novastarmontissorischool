/**
 * Clones a tenant's *configuration* into another tenant. Never its data.
 *
 * Two separate ideas are kept apart here on purpose:
 *
 *   1. `NEVER_CLONED` is the denylist. It is the privacy and safety boundary.
 *   2. `CLONE_STEPS` is the allowlist of models this command may write, in
 *      dependency order.
 *
 * Nothing reads a Prisma delegate that is not named in `CLONE_STEPS`, so a model
 * added to the schema tomorrow is not copied until someone deliberately adds it
 * here, and adding a name to `NEVER_CLONED` that `CLONE_STEPS` also writes is a
 * test failure in `tests/clone.test.ts` rather than a production incident.
 *
 * Counts are printed per model. A clone that quietly copied three of thirteen
 * models is a failure that looks like a success.
 */
import type { Prisma } from "@novastar/database";
import { Prisma as PrismaRuntime } from "@novastar/database";
import { getPrisma } from "../config";
import { out } from "../output";
import { ValidationError } from "../validate";
import { requireConfirmation, resolveTenantCode, type ArgMap } from "./shared";

/**
 * Models that must never be cloned, whatever else changes.
 *
 * The first group is identity: copying credentials, sessions or passkeys hands a
 * real person's access to a new tenant. The second is the roster of real people.
 * The third is money. The fourth is marks and daily register. The fifth is
 * correspondence. The sixth is history that belongs to the school that produced
 * it.
 */
export const NEVER_CLONED: ReadonlySet<string> = new Set<string>([
  // Identity and credentials
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "Passkey",
  "PasskeyChallenge",
  // People
  "Staff",
  "StaffRole",
  "Student",
  "Parent",
  "Enrollment",
  "AttendanceTaker",
  "LeaveRequest",
  // Money
  "Payment",
  "FeeInvoice",
  "FeeInvoiceLineItem",
  "FeeStructure",
  "FeeLineItem",
  // Marks and daily register
  "Assessment",
  "Score",
  "AttendanceStudent",
  "AttendanceStaff",
  // Correspondence
  "Message",
  "Notification",
  // School history and authored content
  "AcademicYear",
  "Term",
  "Class",
  "ClassTerm",
  "ClassSubject",
  "Timetable",
  "TimetableEntry",
  "Syllabus",
  "News",
  "Event",
  "ReportTemplate",
  "Book",
  "BookCategory",
  "BookLoan",
  "InventoryCategory",
  "InventoryItem",
  "InventoryTransaction",
  // Operational history and diagnostics
  "AuditLog",
  "SystemConfig",
  "SystemError",
  "LogEntry",
]);

/**
 * The models this command may write, in dependency order. Children come after
 * their parents because a remapped foreign key needs the parent's new id.
 */
export const CLONE_STEPS: readonly string[] = [
  "Permission",
  "Role",
  "ClassLevel",
  "Subject",
  "SubjectLevel",
  "GradingScale",
  "GradingLevel",
  "FeeCategory",
  "PaymentMethodConfig",
  "AssessmentTypeConfig",
  "House",
  "Branding",
  "ConfigEntity",
];

export interface CloneCounts {
  created: number;
  updated: number;
  skipped: number;
}

export interface CloneModelReport extends CloneCounts {
  model: string;
}

export interface CloneReport {
  readonly source: string;
  readonly target: string;
  readonly dryRun: boolean;
  readonly models: readonly CloneModelReport[];
  readonly totals: CloneCounts;
}

export interface CloneRequest {
  readonly sourceCode: string;
  readonly targetCode: string;
  readonly sourceTenantId: string;
  readonly targetTenantId: string;
  readonly sourceSchoolId: string;
  readonly targetSchoolId: string;
  readonly dryRun?: boolean;
}

interface Existing {
  readonly id: string;
  readonly isSystem?: boolean;
}

interface StepOutcome {
  readonly model: string;
  readonly result: "created" | "updated" | "skipped";
}

interface StepResult {
  readonly outcome: StepOutcome;
  readonly id?: string;
}

interface WriteArgs<TWhere, TCreate, TUpdate> {
  readonly where: TWhere;
  readonly create: TCreate;
  readonly update: TUpdate;
  /** True when the row is absent, in which case `update` must not be sent. */
  readonly createOnly: boolean;
}

/**
 * The `isSystem` rule, applied to every step that carries the column.
 *
 * A target row that is already system-owned is never overwritten; it is counted
 * as skipped. `isSystem` is written on create and never on update, so a clone can
 * neither demote a protected row the target administrator owns nor promote a
 * tenant-authored one to protected. Steps without the column overwrite freely.
 */
async function applyStep<TWhere, TCreate, TUpdate>(step: {
  readonly model: string;
  readonly where: TWhere;
  readonly create: TCreate;
  readonly update: TUpdate;
  readonly existing: Existing | null;
  readonly protectedFlag?: "isSystem";
  readonly dryRun: boolean;
  readonly write: (args: WriteArgs<TWhere, TCreate, TUpdate>) => Promise<{ id: string }>;
}): Promise<StepResult> {
  if (step.existing !== null && step.protectedFlag === "isSystem" && step.existing.isSystem === true) {
    return { outcome: { model: step.model, result: "skipped" } };
  }

  const createOnly = step.existing === null;
  const written = step.dryRun
    ? null
    : await step.write({ where: step.where, create: step.create, update: step.update, createOnly });

  return {
    outcome: { model: step.model, result: createOnly ? "created" : "updated" },
    id: written?.id,
  };
}

/**
 * Copies one tenant's school configuration into another tenant's school.
 *
 * Runs inside a caller's transaction. Every write is an `upsert` on the model's
 * `@@unique` key, so re-running a clone converges on the same state instead of
 * duplicating rows.
 *
 * A dry run performs every read and no write. Ids of rows it would create are
 * unknown, so dependent steps plan against the source ids and count as creates;
 * the counts are therefore a lower bound rather than a rehearsal.
 */
export async function cloneConfiguration(
  tx: Prisma.TransactionClient,
  request: CloneRequest,
): Promise<CloneReport> {
  const dryRun = request.dryRun === true;
  const sourceTenantId = request.sourceTenantId;
  const targetTenantId = request.targetTenantId;
  const sourceSchoolId = request.sourceSchoolId;
  const targetSchoolId = request.targetSchoolId;

  const outcomes: StepOutcome[] = [];
  const record = (result: StepResult): string | undefined => {
    outcomes.push(result.outcome);
    return result.id;
  };

  const classLevelIds = new Map<string, string>();
  const subjectIds = new Map<string, string>();
  const gradingScaleIds = new Map<string, string>();

  // -- Permission ------------------------------------------------------------
  for (const row of await tx.permission.findMany({ where: { tenantId: sourceTenantId }, orderBy: { key: "asc" } })) {
    const where = { tenantId_key: { tenantId: targetTenantId, key: row.key } };
    const existing = await tx.permission.findUnique({ where, select: { id: true, isSystem: true } });
    record(
      await applyStep({
        model: "Permission",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: null,
          key: row.key,
          description: row.description,
          category: row.category,
          resource: row.resource,
          action: row.action,
          scope: row.scope,
          isSystem: row.isSystem,
        },
        // `isSystem` absent by design; see `applyStep`.
        update: {
          description: row.description,
          category: row.category,
          resource: row.resource,
          action: row.action,
          scope: row.scope,
        },
        existing,
        protectedFlag: "isSystem",
        dryRun,
        write: ({ createOnly }) =>
          tx.permission.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: null,
              key: row.key,
              description: row.description,
              category: row.category,
              resource: row.resource,
              action: row.action,
              scope: row.scope,
              isSystem: row.isSystem,
            },
            update: createOnly
              ? {}
              : {
                  description: row.description,
                  category: row.category,
                  resource: row.resource,
                  action: row.action,
                  scope: row.scope,
                },
            select: { id: true },
          }),
      }),
    );
  }

  // -- Role ------------------------------------------------------------------
  for (const row of await tx.role.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { name: "asc" },
  })) {
    const where = {
      tenantId_schoolId_name: { tenantId: targetTenantId, schoolId: targetSchoolId, name: row.name },
    };
    const existing = await tx.role.findUnique({ where, select: { id: true, isSystem: true } });
    record(
      await applyStep({
        model: "Role",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: targetSchoolId,
          name: row.name,
          description: row.description,
          isSystem: row.isSystem,
          permissions: row.permissions,
          inheritsFrom: row.inheritsFrom,
        },
        update: {
          description: row.description,
          permissions: row.permissions,
          inheritsFrom: row.inheritsFrom,
        },
        existing,
        protectedFlag: "isSystem",
        dryRun,
        write: ({ createOnly }) =>
          tx.role.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: targetSchoolId,
              name: row.name,
              description: row.description,
              isSystem: row.isSystem,
              permissions: row.permissions,
              inheritsFrom: row.inheritsFrom,
            },
            update: createOnly
              ? {}
              : {
                  description: row.description,
                  permissions: row.permissions,
                  inheritsFrom: row.inheritsFrom,
                },
            select: { id: true },
          }),
      }),
    );
  }

  // -- ClassLevel ------------------------------------------------------------
  for (const row of await tx.classLevel.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { code: "asc" },
  })) {
    const where = {
      tenantId_schoolId_code: { tenantId: targetTenantId, schoolId: targetSchoolId, code: row.code },
    };
    const existing = await tx.classLevel.findUnique({ where, select: { id: true } });
    const id = record(
      await applyStep({
        model: "ClassLevel",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: targetSchoolId,
          code: row.code,
          name: row.name,
          phase: row.phase,
          order: row.order,
          ageMin: row.ageMin,
          ageMax: row.ageMax,
        },
        update: {
          name: row.name,
          phase: row.phase,
          order: row.order,
          ageMin: row.ageMin,
          ageMax: row.ageMax,
        },
        existing,
        dryRun,
        write: ({ createOnly }) =>
          tx.classLevel.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: targetSchoolId,
              code: row.code,
              name: row.name,
              phase: row.phase,
              order: row.order,
              ageMin: row.ageMin,
              ageMax: row.ageMax,
            },
            update: createOnly
              ? {}
              : {
                  name: row.name,
                  phase: row.phase,
                  order: row.order,
                  ageMin: row.ageMin,
                  ageMax: row.ageMax,
                },
            select: { id: true },
          }),
      }),
    );
    classLevelIds.set(row.id, id ?? row.id);
  }

  // -- Subject ---------------------------------------------------------------
  for (const row of await tx.subject.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { code: "asc" },
  })) {
    const where = {
      tenantId_schoolId_code: { tenantId: targetTenantId, schoolId: targetSchoolId, code: row.code },
    };
    const existing = await tx.subject.findUnique({ where, select: { id: true } });
    const id = record(
      await applyStep({
        model: "Subject",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: targetSchoolId,
          code: row.code,
          name: row.name,
          category: row.category,
          isCore: row.isCore,
          creditHours: row.creditHours,
          description: row.description,
          color: row.color,
        },
        update: {
          name: row.name,
          category: row.category,
          isCore: row.isCore,
          creditHours: row.creditHours,
          description: row.description,
          color: row.color,
        },
        existing,
        dryRun,
        write: ({ createOnly }) =>
          tx.subject.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: targetSchoolId,
              code: row.code,
              name: row.name,
              category: row.category,
              isCore: row.isCore,
              creditHours: row.creditHours,
              description: row.description,
              color: row.color,
            },
            update: createOnly
              ? {}
              : {
                  name: row.name,
                  category: row.category,
                  isCore: row.isCore,
                  creditHours: row.creditHours,
                  description: row.description,
                  color: row.color,
                },
            select: { id: true },
          }),
      }),
    );
    subjectIds.set(row.id, id ?? row.id);
  }

  // -- SubjectLevel ----------------------------------------------------------
  for (const row of await tx.subjectLevel.findMany({ where: { tenantId: sourceTenantId } })) {
    const subjectId = subjectIds.get(row.subjectId);
    const classLevelId = classLevelIds.get(row.classLevelId);
    if (!subjectId || !classLevelId) {
      outcomes.push({ model: "SubjectLevel", result: "skipped" });
      continue;
    }
    const where = { tenantId_subjectId_classLevelId: { tenantId: targetTenantId, subjectId, classLevelId } };
    const existing = await tx.subjectLevel.findUnique({ where, select: { id: true } });
    record(
      await applyStep({
        model: "SubjectLevel",
        where,
        create: {
          tenantId: targetTenantId,
          subjectId,
          classLevelId,
          isRequired: row.isRequired,
          periodsPerWeek: row.periodsPerWeek,
        },
        update: { isRequired: row.isRequired, periodsPerWeek: row.periodsPerWeek },
        existing,
        dryRun,
        write: ({ createOnly }) =>
          tx.subjectLevel.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              subjectId,
              classLevelId,
              isRequired: row.isRequired,
              periodsPerWeek: row.periodsPerWeek,
            },
            update: createOnly ? {} : { isRequired: row.isRequired, periodsPerWeek: row.periodsPerWeek },
            select: { id: true },
          }),
      }),
    );
  }

  // -- GradingScale ----------------------------------------------------------
  // Only school-scoped scales are copied. Prisma types a nullable column inside a
  // compound unique as `string`, so a tenant-scoped scale (`schoolId` null)
  // cannot be selected through `tenantId_schoolId_name` at all. Those rows are
  // reported as skipped rather than silently dropped.
  const tenantLevelScales = await tx.gradingScale.count({
    where: { tenantId: sourceTenantId, schoolId: null },
  });
  for (let i = 0; i < tenantLevelScales; i += 1) {
    outcomes.push({ model: "GradingScale", result: "skipped" });
  }
  for (const row of await tx.gradingScale.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { name: "asc" },
  })) {
    const where = {
      tenantId_schoolId_name: { tenantId: targetTenantId, schoolId: targetSchoolId, name: row.name },
    };
    const existing = await tx.gradingScale.findUnique({ where, select: { id: true } });
    const id = record(
      await applyStep({
        model: "GradingScale",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: targetSchoolId,
          name: row.name,
          description: row.description,
          isDefault: row.isDefault,
          appliesToLevels: row.appliesToLevels,
        },
        update: {
          description: row.description,
          isDefault: row.isDefault,
          appliesToLevels: row.appliesToLevels,
        },
        existing,
        dryRun,
        write: ({ createOnly }) =>
          tx.gradingScale.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: targetSchoolId,
              name: row.name,
              description: row.description,
              isDefault: row.isDefault,
              appliesToLevels: row.appliesToLevels,
            },
            update: createOnly
              ? {}
              : {
                  description: row.description,
                  isDefault: row.isDefault,
                  appliesToLevels: row.appliesToLevels,
                },
            select: { id: true },
          }),
      }),
    );
    gradingScaleIds.set(row.id, id ?? row.id);
  }

  // -- GradingLevel ----------------------------------------------------------
  for (const row of await tx.gradingLevel.findMany({ where: { tenantId: sourceTenantId } })) {
    const gradingScaleId = gradingScaleIds.get(row.gradingScaleId);
    if (!gradingScaleId) {
      outcomes.push({ model: "GradingLevel", result: "skipped" });
      continue;
    }
    const where = { gradingScaleId_key: { gradingScaleId, key: row.key } };
    const existing = await tx.gradingLevel.findUnique({ where, select: { id: true } });
    const data = {
      tenantId: targetTenantId,
      gradingScaleId,
      key: row.key,
      label: row.label,
      minScore: row.minScore,
      maxScore: row.maxScore,
      color: row.color,
      description: row.description,
      order: row.order,
    };
    record(
      await applyStep({
        model: "GradingLevel",
        where,
        create: data,
        update: {
          label: row.label,
          minScore: row.minScore,
          maxScore: row.maxScore,
          color: row.color,
          description: row.description,
          order: row.order,
        },
        existing,
        dryRun,
        write: ({ createOnly }) =>
          tx.gradingLevel.upsert({
            where,
            create: data,
            update: createOnly
              ? {}
              : {
                  label: row.label,
                  minScore: row.minScore,
                  maxScore: row.maxScore,
                  color: row.color,
                  description: row.description,
                  order: row.order,
                },
            select: { id: true },
          }),
      }),
    );
  }

  // -- FeeCategory -----------------------------------------------------------
  for (const row of await tx.feeCategory.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { code: "asc" },
  })) {
    const where = {
      tenantId_schoolId_code: { tenantId: targetTenantId, schoolId: targetSchoolId, code: row.code },
    };
    record(
      await applyStep({
        model: "FeeCategory",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: targetSchoolId,
          code: row.code,
          name: row.name,
          isRecurring: row.isRecurring,
          defaultMandatory: row.defaultMandatory,
          sortOrder: row.sortOrder,
        },
        update: {
          name: row.name,
          isRecurring: row.isRecurring,
          defaultMandatory: row.defaultMandatory,
          sortOrder: row.sortOrder,
        },
        existing: await tx.feeCategory.findUnique({ where, select: { id: true } }),
        dryRun,
        write: ({ createOnly }) =>
          tx.feeCategory.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: targetSchoolId,
              code: row.code,
              name: row.name,
              isRecurring: row.isRecurring,
              defaultMandatory: row.defaultMandatory,
              sortOrder: row.sortOrder,
            },
            update: createOnly
              ? {}
              : {
                  name: row.name,
                  isRecurring: row.isRecurring,
                  defaultMandatory: row.defaultMandatory,
                  sortOrder: row.sortOrder,
                },
            select: { id: true },
          }),
      }),
    );
  }

  // -- PaymentMethodConfig ---------------------------------------------------
  // Configuration: a code, a label, a sort order and an optional provider
  // blob. It is not the `Payment` model, which records what a person actually
  // paid and which `NEVER_CLONED` refuses to touch.
  for (const row of await tx.paymentMethodConfig.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { code: "asc" },
  })) {
    const where = {
      tenantId_schoolId_code: { tenantId: targetTenantId, schoolId: targetSchoolId, code: row.code },
    };
    const data = {
      tenantId: targetTenantId,
      schoolId: targetSchoolId,
      code: row.code,
      name: row.name,
      instructions: row.instructions,
      isEnabled: row.isEnabled,
      sortOrder: row.sortOrder,
      providerConfig: toNullableJson(row.providerConfig),
    };
    record(
      await applyStep({
        model: "PaymentMethodConfig",
        where,
        create: data,
        update: {
          name: row.name,
          instructions: row.instructions,
          isEnabled: row.isEnabled,
          sortOrder: row.sortOrder,
          providerConfig: toNullableJson(row.providerConfig),
        },
        existing: await tx.paymentMethodConfig.findUnique({ where, select: { id: true } }),
        dryRun,
        write: ({ createOnly }) =>
          tx.paymentMethodConfig.upsert({
            where,
            create: data,
            update: createOnly
              ? {}
              : {
                  name: row.name,
                  instructions: row.instructions,
                  isEnabled: row.isEnabled,
                  sortOrder: row.sortOrder,
                  providerConfig: toNullableJson(row.providerConfig),
                },
            select: { id: true },
          }),
      }),
    );
  }

  // -- AssessmentTypeConfig --------------------------------------------------
  for (const row of await tx.assessmentTypeConfig.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { code: "asc" },
  })) {
    const where = {
      tenantId_schoolId_code: { tenantId: targetTenantId, schoolId: targetSchoolId, code: row.code },
    };
    record(
      await applyStep({
        model: "AssessmentTypeConfig",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: targetSchoolId,
          code: row.code,
          name: row.name,
          description: row.description,
          defaultWeight: row.defaultWeight,
          maxScore: row.maxScore,
          appliesToLevels: row.appliesToLevels,
          isActive: row.isActive,
        },
        update: {
          name: row.name,
          description: row.description,
          defaultWeight: row.defaultWeight,
          maxScore: row.maxScore,
          appliesToLevels: row.appliesToLevels,
          isActive: row.isActive,
        },
        existing: await tx.assessmentTypeConfig.findUnique({ where, select: { id: true } }),
        dryRun,
        write: ({ createOnly }) =>
          tx.assessmentTypeConfig.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: targetSchoolId,
              code: row.code,
              name: row.name,
              description: row.description,
              defaultWeight: row.defaultWeight,
              maxScore: row.maxScore,
              appliesToLevels: row.appliesToLevels,
              isActive: row.isActive,
            },
            update: createOnly
              ? {}
              : {
                  name: row.name,
                  description: row.description,
                  defaultWeight: row.defaultWeight,
                  maxScore: row.maxScore,
                  appliesToLevels: row.appliesToLevels,
                  isActive: row.isActive,
                },
            select: { id: true },
          }),
      }),
    );
  }

  // -- House -----------------------------------------------------------------
  for (const row of await tx.house.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
    orderBy: { name: "asc" },
  })) {
    const where = {
      tenantId_schoolId_name: { tenantId: targetTenantId, schoolId: targetSchoolId, name: row.name },
    };
    record(
      await applyStep({
        model: "House",
        where,
        create: {
          tenantId: targetTenantId,
          schoolId: targetSchoolId,
          name: row.name,
          color: row.color,
          motto: row.motto,
          // `patronId` is a foreign key onto a `Staff` row. Copying the value
          // would point the target school's house at a record that does not
          // exist there, so the link is dropped rather than remapped.
          patronId: null,
        },
        update: { color: row.color, motto: row.motto, patronId: null },
        existing: await tx.house.findUnique({ where, select: { id: true } }),
        dryRun,
        write: ({ createOnly }) =>
          tx.house.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: targetSchoolId,
              name: row.name,
              color: row.color,
              motto: row.motto,
              patronId: null,
            },
            update: createOnly ? {} : { color: row.color, motto: row.motto, patronId: null },
            select: { id: true },
          }),
      }),
    );
  }

  // -- Branding --------------------------------------------------------------
  for (const row of await tx.branding.findMany({
    where: { tenantId: sourceTenantId, schoolId: sourceSchoolId },
  })) {
    const where = { tenantId_schoolId: { tenantId: targetTenantId, schoolId: targetSchoolId } };
    const data = {
      tenantId: targetTenantId,
      schoolId: targetSchoolId,
      name: row.name,
      logoUrl: row.logoUrl,
      faviconUrl: row.faviconUrl,
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      accentColor: row.accentColor,
      motto: row.motto,
      address: row.address,
      phone: row.phone,
      email: row.email,
      website: row.website,
      socialLinks: toNullableJson(row.socialLinks),
    };
    record(
      await applyStep({
        model: "Branding",
        where,
        create: data,
        update: {
          name: row.name,
          logoUrl: row.logoUrl,
          faviconUrl: row.faviconUrl,
          primaryColor: row.primaryColor,
          secondaryColor: row.secondaryColor,
          accentColor: row.accentColor,
          motto: row.motto,
          address: row.address,
          phone: row.phone,
          email: row.email,
          website: row.website,
          socialLinks: toNullableJson(row.socialLinks),
        },
        existing: await tx.branding.findUnique({ where, select: { id: true } }),
        dryRun,
        write: ({ createOnly }) =>
          tx.branding.upsert({
            where,
            create: data,
            update: createOnly
              ? {}
              : {
                  name: row.name,
                  logoUrl: row.logoUrl,
                  faviconUrl: row.faviconUrl,
                  primaryColor: row.primaryColor,
                  secondaryColor: row.secondaryColor,
                  accentColor: row.accentColor,
                  motto: row.motto,
                  address: row.address,
                  phone: row.phone,
                  email: row.email,
                  website: row.website,
                  socialLinks: toNullableJson(row.socialLinks),
                },
            select: { id: true },
          }),
      }),
    );
  }

  // -- ConfigEntity ----------------------------------------------------------
  for (const row of await tx.configEntity.findMany({
    where: { tenantId: sourceTenantId },
    orderBy: { type: "asc" },
  })) {
    const where = { tenantId_type: { tenantId: targetTenantId, type: row.type } };
    const existing = await tx.configEntity.findUnique({ where, select: { id: true, isSystem: true } });
    record(
      await applyStep({
        model: "ConfigEntity",
        where,
        create: {
          tenantId: targetTenantId,
          // A tenant-scoped row stays tenant-scoped; a row scoped to the source
          // school is re-pointed at the target school.
          schoolId: row.schoolId === sourceSchoolId ? targetSchoolId : row.schoolId,
          type: row.type,
          name: row.name,
          namePlural: row.namePlural,
          description: row.description,
          icon: row.icon,
          color: row.color,
          definition: toJson(row.definition),
          isActive: row.isActive,
          isSystem: row.isSystem,
        },
        // `isSystem` absent by design; see `applyStep`.
        update: {
          name: row.name,
          namePlural: row.namePlural,
          description: row.description,
          icon: row.icon,
          color: row.color,
          definition: toJson(row.definition),
          isActive: row.isActive,
        },
        existing,
        protectedFlag: "isSystem",
        dryRun,
        write: ({ createOnly }) =>
          tx.configEntity.upsert({
            where,
            create: {
              tenantId: targetTenantId,
              schoolId: row.schoolId === sourceSchoolId ? targetSchoolId : row.schoolId,
              type: row.type,
              name: row.name,
              namePlural: row.namePlural,
              description: row.description,
              icon: row.icon,
              color: row.color,
              definition: toJson(row.definition),
              isActive: row.isActive,
              isSystem: row.isSystem,
            },
            update: createOnly
              ? {}
              : {
                  name: row.name,
                  namePlural: row.namePlural,
                  description: row.description,
                  icon: row.icon,
                  color: row.color,
                  definition: toJson(row.definition),
                  isActive: row.isActive,
                },
            select: { id: true },
          }),
      }),
    );
  }

  return buildReport(request, outcomes);
}

/**
 * A JSON column distinguishes SQL NULL from the JSON value `null`, and Prisma
 * wants them named explicitly. A source row that already holds either kind of
 * null round-trips unchanged; anything else is passed through as a JSON value.
 */
function toNullableJson(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof PrismaRuntime.JsonNull | typeof PrismaRuntime.DbNull {
  if (value === null) return PrismaRuntime.DbNull;
  return value as Prisma.InputJsonValue;
}

/** For non-null JSON columns, where a JSON null stays a JSON null. */
function toJson(value: Prisma.JsonValue): Prisma.InputJsonValue | typeof PrismaRuntime.JsonNull {
  if (value === null) return PrismaRuntime.JsonNull;
  return value as Prisma.InputJsonValue;
}

function buildReport(request: CloneRequest, outcomes: readonly StepOutcome[]): CloneReport {
  for (const outcome of outcomes) {
    if (!CLONE_STEPS.includes(outcome.model)) {
      throw new Error(`Internal error: clone step "${outcome.model}" is not listed in CLONE_STEPS.`);
    }
  }

  const totals: CloneCounts = { created: 0, updated: 0, skipped: 0 };
  const models: CloneModelReport[] = CLONE_STEPS.map((model) => {
    const counts: CloneCounts = { created: 0, updated: 0, skipped: 0 };
    for (const outcome of outcomes) {
      if (outcome.model !== model) continue;
      counts[outcome.result] += 1;
      totals[outcome.result] += 1;
    }
    return { model, ...counts };
  });

  return {
    source: request.sourceCode,
    target: request.targetCode,
    dryRun: request.dryRun === true,
    models,
    totals,
  };
}

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

export const CLONE_HELP = `Usage: novastar-tenant clone --from <tenant-code> --to <tenant-code> [options]

Copies one tenant's configuration into another tenant. Never copies people,
credentials, money, marks or correspondence; commands/clone.ts holds the
NEVER_CLONED denylist that enforces it.

Options:
  --from <code>     source tenant code (required)
  --to <code>       target tenant code (required)
  --school <code>   school code, applied to both sides (default: the first school)
  --apply           perform the writes. Without it the command only prints the plan.
  --yes             required alongside --apply when stdin is not a terminal
  --json            print the report as JSON`;

export async function runClone(args: ArgMap): Promise<void> {
  const sourceCode = resolveTenantCode(args, "from");
  const targetCode = resolveTenantCode(args, "to");
  const schoolCode = args.get("school");
  const apply = args.flag("apply");

  const db = getPrisma();
  const source = await db.tenant.findUnique({ where: { code: sourceCode }, select: { id: true } });
  if (!source) throw new ValidationError([{ path: "--from", message: `No tenant with code "${sourceCode}".` }]);
  const target = await db.tenant.findUnique({ where: { code: targetCode }, select: { id: true } });
  if (!target) throw new ValidationError([{ path: "--to", message: `No tenant with code "${targetCode}".` }]);

  const sourceSchoolId = await pickSchoolId(db, source.id, schoolCode, "--from");
  const targetSchoolId = await pickSchoolId(db, target.id, schoolCode, "--to");

  if (apply) requireConfirmation(args, `clone ${sourceCode} into ${targetCode}`);

  const request: CloneRequest = {
    sourceCode,
    targetCode,
    sourceTenantId: source.id,
    targetTenantId: target.id,
    sourceSchoolId,
    targetSchoolId,
    dryRun: !apply,
  };

  const report = await db.$transaction((tx) => cloneConfiguration(tx, request));

  if (args.flag("json")) {
    out.json(report);
    return;
  }

  out.line(apply ? "Clone report:" : "Clone plan (no writes):");
  out.table(report.models, [
    { header: "MODEL", value: (row) => row.model },
    { header: "CREATED", value: (row) => row.created, align: "right" },
    { header: "UPDATED", value: (row) => row.updated, align: "right" },
    { header: "SKIPPED", value: (row) => row.skipped, align: "right" },
  ]);
  out.line(
    `${report.source} -> ${report.target}: created ${report.totals.created}, ` +
      `updated ${report.totals.updated}, skipped ${report.totals.skipped}`,
  );
}

async function pickSchoolId(
  db: ReturnType<typeof getPrisma>,
  tenantId: string,
  schoolCode: string | undefined,
  flag: string,
): Promise<string> {
  const school = schoolCode
    ? await db.school.findUnique({
        where: { tenantId_code: { tenantId, code: schoolCode } },
        select: { id: true },
      })
    : await db.school.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true } });

  if (!school) {
    throw new ValidationError([
      {
        path: flag,
        message: `No school${schoolCode ? ` with code "${schoolCode}"` : ""} on this tenant.`,
      },
    ]);
  }
  return school.id;
}