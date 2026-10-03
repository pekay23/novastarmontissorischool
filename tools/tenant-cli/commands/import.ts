/**
 * `import` -- apply an exported configuration document to a tenant.
 *
 * A dry run is the default. `--apply` is required to write, and `--yes` is
 * required alongside `--apply` when there is no terminal to ask. The asymmetry is
 * deliberate: producing a plan is free, so the default is free; changing a
 * school that is live on Monday morning is not.
 *
 * The document is the inverse of `config export`: rows are addressed by their
 * natural keys, resolved against the target tenant, then written with the same
 * `isSystem` rule `clone` uses.
 */
import { readFileSync } from "node:fs";
import type { Prisma } from "@novastar/database";
import { getPrisma } from "../config";
import { out } from "../output";
import { ValidationError, formatIssues } from "../validate";
import { EXPORT_SCHEMA_ID, type ExportedConfig, type ExportedModels } from "./config/export";
import { requireConfirmation, resolveTenantCode, type ArgMap } from "./shared";

export const IMPORT_HELP = `Usage: novastar-tenant import --file <file> [--tenant <code>] [--apply]

Applies a document produced by \`novastar-tenant config export\`.

Without --apply the command prints the plan and writes nothing. With --apply it
also needs --yes unless stdin is a terminal.

Options:
  --file <file>      the exported JSON document (required)
  --tenant <code>    target tenant code (default: TENANT_CODE)
  --school <code>    target school code (default: the first school)
  --apply            perform the writes
  --yes              confirm when stdin is not a terminal
  --json             print the report as JSON`;

export interface ImportCounts {
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportReport {
  readonly target: string;
  readonly dryRun: boolean;
  readonly counts: Readonly<Record<string, ImportCounts>>;
  readonly total: ImportCounts;
  readonly problems: readonly string[];
}

export async function runImport(args: ArgMap): Promise<void> {
  const file = args.require("file");
  const tenantCode = resolveTenantCode(args);
  const db = getPrisma();

  const document = readDocument(file);
  const tenant = await db.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, schools: { orderBy: { code: "asc" }, select: { id: true, code: true } } },
  });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${tenantCode}".` }]);
  }

  const schoolCode = args.get("school");
  const school = schoolCode
    ? tenant.schools.find((candidate) => candidate.code === schoolCode)
    : tenant.schools[0];
  if (!school) {
    throw new ValidationError([
      { path: "--school", message: `Tenant ${tenantCode} has no matching school.` },
    ]);
  }

  const apply = args.flag("apply");
  if (apply) await requireConfirmation(args, `import ${file} into ${tenantCode}`);

  const report = await db.$transaction((tx) =>
    applyDocument(tx, document.config, {
      tenantId: tenant.id,
      schoolId: school.id,
      dryRun: !apply,
    }),
  );

  if (args.flag("json")) {
    out.json(report);
    return;
  }

  out.line(apply ? "Import report:" : "Import plan (no writes):");
  out.table(
    Object.entries(report.counts).map(([model, counts]) => ({ model, ...counts })),
    [
      { header: "MODEL", value: (row) => row.model },
      { header: "CREATED", value: (row) => row.created, align: "right" },
      { header: "UPDATED", value: (row) => row.updated, align: "right" },
      { header: "SKIPPED", value: (row) => row.skipped, align: "right" },
    ],
    { empty: "The document contained no configuration." },
  );
  out.line(
    `Totals: created ${report.total.created}, updated ${report.total.updated}, skipped ${report.total.skipped}`,
  );
  for (const problem of report.problems) out.warn(problem);
}

function readDocument(file: string): ExportedConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ValidationError([
      { path: "--file", message: `Could not read ${file}: ${error instanceof Error ? error.message : String(error)}` },
    ]);
  }

  const document = parsed as Partial<ExportedConfig> | null;
  const issues: { path: string; message: string }[] = [];
  if (!document || typeof document !== "object") issues.push({ path: "file", message: "Not a JSON object." });
  if (document?.$schema !== EXPORT_SCHEMA_ID) {
    issues.push({ path: "$schema", message: `Expected "${EXPORT_SCHEMA_ID}".` });
  }
  if (!document?.config || typeof document.config !== "object") {
    issues.push({ path: "config", message: "Missing." });
  }
  if (issues.length > 0) {
    const error = new ValidationError(issues);
    throw new ValidationError([{ path: "--file", message: `\n${formatIssues(error.issues)}` }]);
  }

  return document as ExportedConfig;
}

interface Scope {
  readonly tenantId: string;
  readonly schoolId: string;
  readonly dryRun: boolean;
}

/**
 * Writes the document into one tenant, reporting what each model did.
 *
 * The same `isSystem` rule as `clone`: a target row that is already
 * system-owned is skipped, and `isSystem` is never written on update.
 */
export async function applyDocument(
  tx: Prisma.TransactionClient,
  config: ExportedModels,
  scope: Scope,
): Promise<ImportReport> {
  const counts: Record<string, ImportCounts> = {};
  const problems: string[] = [];
  const classLevelIds = new Map<string, string>();
  const subjectIds = new Map<string, string>();
  const scaleIds = new Map<string, string>();

  const record = (model: string, result: keyof ImportCounts): void => {
    counts[model] ??= { created: 0, updated: 0, skipped: 0 };
    counts[model][result] += 1;
  };

  const skipSystem = (model: string, existing: { isSystem: boolean } | null): boolean => {
    if (existing?.isSystem === true) {
      record(model, "skipped");
      return true;
    }
    return false;
  };

  for (const row of config.permissions ?? []) {
    const key = text(row, "key", problems);
    if (!key) continue;
    const where = { tenantId_key: { tenantId: scope.tenantId, key } };
    const existing = await tx.permission.findUnique({ where, select: { isSystem: true } });
    if (skipSystem("Permission", existing)) continue;
    const createOnly = existing === null;
    if (!scope.dryRun) {
      await tx.permission.upsert({
        where,
        create: {
          tenantId: scope.tenantId,
          schoolId: null,
          key,
          description: text(row, "description") ?? "",
          category: text(row, "category") ?? "system",
          resource: text(row, "resource") ?? "system",
          action: text(row, "action") ?? "read",
          scope: text(row, "scope") ?? "all",
          isSystem: boolean(row, "isSystem") ?? false,
        },
        update: createOnly
          ? {}
          : {
              description: text(row, "description") ?? "",
              category: text(row, "category") ?? "system",
              resource: text(row, "resource") ?? "system",
              action: text(row, "action") ?? "read",
              scope: text(row, "scope") ?? "all",
            },
      });
    }
    record("Permission", createOnly ? "created" : "updated");
  }

  for (const row of config.roles ?? []) {
    const name = text(row, "name", problems);
    if (!name) continue;
    const where = {
      tenantId_schoolId_name: { tenantId: scope.tenantId, schoolId: scope.schoolId, name },
    };
    const existing = await tx.role.findUnique({ where, select: { isSystem: true } });
    if (skipSystem("Role", existing)) continue;
    const createOnly = existing === null;
    const permissions = strings(row, "permissions");
    const inheritsFrom = strings(row, "inheritsFrom");
    if (!scope.dryRun) {
      await tx.role.upsert({
        where,
        create: {
          tenantId: scope.tenantId,
          schoolId: scope.schoolId,
          name,
          description: text(row, "description"),
          isSystem: boolean(row, "isSystem") ?? false,
          permissions,
          inheritsFrom,
        },
        update: createOnly ? {} : { description: text(row, "description"), permissions, inheritsFrom },
      });
    }
    record("Role", createOnly ? "created" : "updated");
  }

  for (const row of config.classLevels ?? []) {
    const code = text(row, "code", problems);
    if (!code) continue;
    const where = {
      tenantId_schoolId_code: { tenantId: scope.tenantId, schoolId: scope.schoolId, code },
    };
    const existing = await tx.classLevel.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const phase = (text(row, "phase") ?? "PRIMARY") as never;
    const data = {
      name: text(row, "name") ?? code,
      phase,
      order: integer(row, "order") ?? 0,
      ageMin: integer(row, "ageMin") ?? 0,
      ageMax: integer(row, "ageMax") ?? 0,
    };
    const written = scope.dryRun
      ? null
      : await tx.classLevel.upsert({
          where,
          create: { tenantId: scope.tenantId, schoolId: scope.schoolId, code, ...data },
          update: createOnly ? {} : data,
          select: { id: true },
        });
    classLevelIds.set(code, written?.id ?? existing?.id ?? code);
    record("ClassLevel", createOnly ? "created" : "updated");
  }

  for (const row of config.subjects ?? []) {
    const code = text(row, "code", problems);
    if (!code) continue;
    const where = {
      tenantId_schoolId_code: { tenantId: scope.tenantId, schoolId: scope.schoolId, code },
    };
    const existing = await tx.subject.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      name: text(row, "name") ?? code,
      category: (text(row, "category") ?? "OTHER") as never,
      isCore: boolean(row, "isCore") ?? true,
      creditHours: integer(row, "creditHours") ?? 1,
      description: text(row, "description"),
      color: text(row, "color"),
    };
    const written = scope.dryRun
      ? null
      : await tx.subject.upsert({
          where,
          create: { tenantId: scope.tenantId, schoolId: scope.schoolId, code, ...data },
          update: createOnly ? {} : data,
          select: { id: true },
        });
    subjectIds.set(code, written?.id ?? existing?.id ?? code);
    record("Subject", createOnly ? "created" : "updated");
  }

  for (const row of config.subjectLevels ?? []) {
    const subjectCode = text(row, "subjectCode", problems);
    const classLevelCode = text(row, "classLevelCode", problems);
    if (!subjectCode || !classLevelCode) continue;
    const subjectId = subjectIds.get(subjectCode);
    const classLevelId = classLevelIds.get(classLevelCode);
    if (!subjectId || !classLevelId) {
      record("SubjectLevel", "skipped");
      problems.push(`SubjectLevel ${subjectCode}/${classLevelCode}: parent row was not in the document.`);
      continue;
    }
    const where = { tenantId_subjectId_classLevelId: { tenantId: scope.tenantId, subjectId, classLevelId } };
    const existing = await tx.subjectLevel.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      isRequired: boolean(row, "isRequired") ?? true,
      periodsPerWeek: integer(row, "periodsPerWeek") ?? 4,
    };
    if (!scope.dryRun) {
      await tx.subjectLevel.upsert({
        where,
        create: { tenantId: scope.tenantId, subjectId, classLevelId, ...data },
        update: createOnly ? {} : data,
      });
    }
    record("SubjectLevel", createOnly ? "created" : "updated");
  }

  for (const row of config.gradingScales ?? []) {
    const name = text(row, "name", problems);
    if (!name) continue;
    const where = {
      tenantId_schoolId_name: { tenantId: scope.tenantId, schoolId: scope.schoolId, name },
    };
    const existing = await tx.gradingScale.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      description: text(row, "description"),
      isDefault: boolean(row, "isDefault") ?? false,
      appliesToLevels: strings(row, "appliesToLevels"),
    };
    const written = scope.dryRun
      ? null
      : await tx.gradingScale.upsert({
          where,
          create: { tenantId: scope.tenantId, schoolId: scope.schoolId, name, ...data },
          update: createOnly ? {} : data,
          select: { id: true },
        });
    scaleIds.set(name, written?.id ?? existing?.id ?? name);
    record("GradingScale", createOnly ? "created" : "updated");
  }

  for (const row of config.gradingLevels ?? []) {
    const scaleName = text(row, "scale", problems);
    const key = text(row, "key", problems);
    if (!scaleName || !key) continue;
    const gradingScaleId = scaleIds.get(scaleName);
    if (!gradingScaleId) {
      record("GradingLevel", "skipped");
      problems.push(`GradingLevel ${scaleName}/${key}: the scale was not in the document.`);
      continue;
    }
    const where = { gradingScaleId_key: { gradingScaleId, key } };
    const existing = await tx.gradingLevel.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      label: text(row, "label") ?? key,
      minScore: integer(row, "minScore") ?? 0,
      maxScore: integer(row, "maxScore") ?? 0,
      point: text(row, "point") ?? "0",
      color: text(row, "color") ?? "#000000",
      description: text(row, "description"),
      order: integer(row, "order") ?? 0,
    };
    if (!scope.dryRun) {
      await tx.gradingLevel.upsert({
        where,
        create: { tenantId: scope.tenantId, gradingScaleId, key, ...data },
        update: createOnly ? {} : data,
      });
    }
    record("GradingLevel", createOnly ? "created" : "updated");
  }

  for (const row of config.feeCategories ?? []) {
    const code = text(row, "code", problems);
    if (!code) continue;
    const where = {
      tenantId_schoolId_code: { tenantId: scope.tenantId, schoolId: scope.schoolId, code },
    };
    const existing = await tx.feeCategory.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      name: text(row, "name") ?? code,
      isRecurring: boolean(row, "isRecurring") ?? true,
      defaultMandatory: boolean(row, "defaultMandatory") ?? true,
      sortOrder: integer(row, "sortOrder") ?? 0,
    };
    if (!scope.dryRun) {
      await tx.feeCategory.upsert({
        where,
        create: { tenantId: scope.tenantId, schoolId: scope.schoolId, code, ...data },
        update: createOnly ? {} : data,
      });
    }
    record("FeeCategory", createOnly ? "created" : "updated");
  }

  for (const row of config.paymentMethods ?? []) {
    const code = text(row, "code", problems);
    if (!code) continue;
    const where = {
      tenantId_schoolId_code: { tenantId: scope.tenantId, schoolId: scope.schoolId, code },
    };
    const existing = await tx.paymentMethodConfig.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      name: text(row, "name") ?? code,
      instructions: text(row, "instructions"),
      isEnabled: boolean(row, "isEnabled") ?? true,
      sortOrder: integer(row, "sortOrder") ?? 0,
      providerConfig: (row.providerConfig ?? null) as never,
    };
    if (!scope.dryRun) {
      await tx.paymentMethodConfig.upsert({
        where,
        create: { tenantId: scope.tenantId, schoolId: scope.schoolId, code, ...data },
        update: createOnly ? {} : data,
      });
    }
    record("PaymentMethodConfig", createOnly ? "created" : "updated");
  }

  for (const row of config.assessmentTypes ?? []) {
    const code = text(row, "code", problems);
    if (!code) continue;
    const where = {
      tenantId_schoolId_code: { tenantId: scope.tenantId, schoolId: scope.schoolId, code },
    };
    const existing = await tx.assessmentTypeConfig.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      name: text(row, "name") ?? code,
      description: text(row, "description"),
      defaultWeight: text(row, "defaultWeight") ?? "1",
      maxScore: integer(row, "maxScore") ?? 100,
      appliesToLevels: strings(row, "appliesToLevels"),
      isActive: boolean(row, "isActive") ?? true,
    };
    if (!scope.dryRun) {
      await tx.assessmentTypeConfig.upsert({
        where,
        create: { tenantId: scope.tenantId, schoolId: scope.schoolId, code, ...data },
        update: createOnly ? {} : data,
      });
    }
    record("AssessmentTypeConfig", createOnly ? "created" : "updated");
  }

  for (const row of config.houses ?? []) {
    const name = text(row, "name", problems);
    if (!name) continue;
    const where = {
      tenantId_schoolId_name: { tenantId: scope.tenantId, schoolId: scope.schoolId, name },
    };
    const existing = await tx.house.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    // `patronId` is never carried: it is a link onto a member of staff, and the
    // exported document deliberately contains no people.
    const data = { color: text(row, "color") ?? "#059669", motto: text(row, "motto"), patronId: null };
    if (!scope.dryRun) {
      await tx.house.upsert({
        where,
        create: { tenantId: scope.tenantId, schoolId: scope.schoolId, name, ...data },
        update: createOnly ? {} : data,
      });
    }
    record("House", createOnly ? "created" : "updated");
  }

  if (config.branding) {
    const row = config.branding;
    const where = { tenantId_schoolId: { tenantId: scope.tenantId, schoolId: scope.schoolId } };
    const existing = await tx.branding.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      name: text(row, "name") ?? "Branding",
      logoUrl: text(row, "logoUrl"),
      faviconUrl: text(row, "faviconUrl"),
      primaryColor: text(row, "primaryColor") ?? "#059669",
      secondaryColor: text(row, "secondaryColor") ?? "#0891b2",
      accentColor: text(row, "accentColor") ?? "#d97706",
      motto: text(row, "motto"),
      address: text(row, "address"),
      phone: text(row, "phone"),
      email: text(row, "email"),
      website: text(row, "website"),
      socialLinks: (row.socialLinks ?? null) as never,
    };
    if (!scope.dryRun) {
      await tx.branding.upsert({
        where,
        create: { tenantId: scope.tenantId, schoolId: scope.schoolId, ...data },
        update: createOnly ? {} : data,
      });
    }
    record("Branding", createOnly ? "created" : "updated");
  }

  for (const row of config.configEntities ?? []) {
    const type = text(row, "type", problems);
    if (!type) continue;
    const where = { tenantId_type: { tenantId: scope.tenantId, type } };
    const existing = await tx.configEntity.findUnique({ where, select: { isSystem: true } });
    if (skipSystem("ConfigEntity", existing)) continue;
    const createOnly = existing === null;
    const schoolId = text(row, "scope") === "school" ? scope.schoolId : null;
    const data = {
      name: text(row, "name") ?? type,
      namePlural: text(row, "namePlural") ?? type,
      description: text(row, "description"),
      icon: text(row, "icon"),
      color: text(row, "color"),
      definition: row.definition as never,
      isActive: boolean(row, "isActive") ?? true,
    };
    if (!scope.dryRun) {
      await tx.configEntity.upsert({
        where,
        create: {
          tenantId: scope.tenantId,
          schoolId,
          type,
          ...data,
          isSystem: boolean(row, "isSystem") ?? false,
        },
        // `isSystem` absent by design; see the note above.
        update: createOnly ? {} : data,
      });
    }
    record("ConfigEntity", createOnly ? "created" : "updated");
  }

  const total: ImportCounts = { created: 0, updated: 0, skipped: 0 };
  for (const perModel of Object.values(counts)) {
    total.created += perModel.created;
    total.updated += perModel.updated;
    total.skipped += perModel.skipped;
  }

  return { target: scope.tenantId, dryRun: scope.dryRun, counts, total, problems };
}

function text(row: Record<string, unknown>, key: string, problems?: string[]): string | null {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return null;
  problems?.push(`${key}: expected a string, received ${typeof value}.`);
  return null;
}

function boolean(row: Record<string, unknown>, key: string): boolean | undefined {
  const value = row[key];
  return typeof value === "boolean" ? value : undefined;
}

function integer(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function strings(row: Record<string, unknown>, key: string): string[] {
  const value = row[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}