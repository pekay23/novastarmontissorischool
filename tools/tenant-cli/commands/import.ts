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
 *
 * A row the API would refuse is refused here too, on the same terms and through the
 * same helpers — most visibly a grading band, which is the one row in this document a
 * bad value in silently mis-grades a child rather than merely looking wrong. Refusal
 * follows the convention already in this file: the row is counted `skipped`, the reason
 * is pushed onto `problems`, and the rest of the document is applied. Nothing is
 * rolled back and nothing is fatal, because that is what a row with a missing parent
 * already does and what the operator reading the report expects to see.
 */
import { readFileSync } from "node:fs";
import type { Prisma } from "@novastar/database";
// The band rules live in `@novastar/shared-utils` and this command must not grow a
// second copy of them. Declared as a dependency of this package, so it is reached
// by package name like every other cross-package import in the repo.
import {
  gradeBandWriteProblems,
  gradingScaleScopeWhere,
} from "@novastar/shared-utils";
import {
  GradingLevelCreateSchema,
  GradingLevelPositionSetSchema,
} from "@novastar/shared-types";
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
 * A band as the import needs it to judge a scale: the two bounds the cross-row rule
 * reads, plus the two columns that are unique within a scale.
 *
 * Structurally a `NamedGradeBand`, which is what `gradeBandWriteProblems` takes, so
 * the rule that refuses a band here is the one the HTTP write path calls.
 *
 * `id` is never null. `gradeBandWriteProblems` drops the row being edited by comparing
 * ids, so an entry with no id would be dropped by an `editedId` of null and silently
 * removed from the judgement — the row nobody was editing. A band that exists only in
 * the document therefore gets a synthetic id, and a scale the database holds gives its
 * own.
 */
interface ImportBand {
  readonly id: string;
  readonly key: string;
  readonly minScore: number;
  readonly maxScore: number;
  readonly order: number;
}

/**
 * Marks an id that the database has not issued, so a band added by this document is
 * still distinguishable from the row it replaces. A cuid cannot contain a colon.
 */
const DOCUMENT_BAND_ID = "document:";

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
  /**
   * Every band each scale will hold once the document is applied, keyed by scale id.
   *
   * Seeded from the scale's own stored bands and extended as bands are accepted, so a
   * row is judged against the whole scale this document is about to leave behind — and
   * so it is judged the same way in a dry run, where nothing is written and re-reading
   * would keep returning the pre-import set. The stored read is scoped to this tenant,
   * because a band the caller cannot see has to read as absent: a conflict with another
   * school's band is not this band's conflict, and naming those bands in the refusal
   * would send an operator to fix a scale that was never wrong.
   */
  const scaleBands = new Map<string, ImportBand[]>();

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

  /**
   * The bands a scale holds, read once and then extended as this document's bands are
   * accepted. Scoped to `scope.tenantId`: a band belonging to another tenant is not
   * this scale's band, and a conflict with one is not this write's conflict.
   */
  const bandsOf = async (gradingScaleId: string): Promise<ImportBand[]> => {
    const loaded = scaleBands.get(gradingScaleId);
    if (loaded) return loaded;
    const stored = await tx.gradingLevel.findMany({
      where: { gradingScaleId, tenantId: scope.tenantId },
      select: { id: true, key: true, minScore: true, maxScore: true, order: true },
    });
    const bands: ImportBand[] = stored.map((row) => ({
      id: row.id,
      key: row.key,
      minScore: row.minScore,
      maxScore: row.maxScore,
      order: row.order,
    }));
    scaleBands.set(gradingScaleId, bands);
    return bands;
  };

  const seenBandKeys = new Set<string>();

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

    // 1. The row's own shape, through the schema the HTTP create path parses it with.
    //    That is the `0-100` bounds, integer percentages, `minScore <= maxScore`, and
    //    the `#rrggbb` colour — a colour the report's `contrastTextColor` cannot act on
    //    is a badge the report card cannot draw, so it is refused here rather than
    //    discovered on a child's report. No default stands in for a missing bound any
    //    more: the old `?? 0` turned a mistyped `"minScore": "80"` into a band of
    //    0-0, which is a valid-looking row and a band that claims nothing.
    const parsed = GradingLevelCreateSchema.safeParse({
      gradingScaleId,
      key,
      label: text(row, "label") ?? key,
      minScore: integer(row, "minScore"),
      maxScore: integer(row, "maxScore"),
      color: text(row, "color") ?? "#000000",
      description: text(row, "description"),
      order: integer(row, "order") ?? 0,
    });
    if (!parsed.success) {
      record("GradingLevel", "skipped");
      problems.push(`GradingLevel ${scaleName}/${key}: ${zodIssues(parsed.error)}`);
      continue;
    }

    // 2. `key` is `@@unique([gradingScaleId, key])`, so two document rows claiming one
    //    key would leave the surviving row decided by document order. The index would
    //    refuse the second write part-way through the transaction and say so as a
    //    driver error; here it is a refusal that names the two rows.
    const documentKey = `${gradingScaleId}/${key}`;
    if (seenBandKeys.has(documentKey)) {
      record("GradingLevel", "skipped");
      problems.push(`GradingLevel ${scaleName}/${key}: the document claims this key twice.`);
      continue;
    }
    seenBandKeys.add(documentKey);

    // 3. The parent is proved, not inherited from the map. A `grading_level` row has no
    //    `schoolId` of its own, so the school that grades a child against a band is the
    //    school of the band's SCALE — a band whose own `tenantId` is this import's can
    //    still hang from another school's scale, and it is then invisible to the school
    //    whose grading it has changed. The predicate is `gradingScaleScopeWhere`, the one
    //    the HTTP write path's `gradingScaleParentScopeWriteRule` uses, so the two
    //    cannot drift. Only an applying import can mis-attach a band and only an
    //    applying import has a stored scale to prove: a dry run writes nothing, so its
    //    parent is the scale the loop above is about to create under this school.
    if (!scope.dryRun && !(await ownsScale(tx, gradingScaleId, scope))) {
      record("GradingLevel", "skipped");
      problems.push(`GradingLevel ${scaleName}/${key}: the scale is not this tenant's or this school's.`);
      continue;
    }

    // 4. The scale this band would leave behind, never the band alone: no band is
    //    exhaustive by itself, so `0-49` on its own is a hole and a valid bottom half of
    //    a scale, and a rule applied per row would either refuse every partial scale or
    //    miss every conflict. `gradeBandWriteProblems` is the whole-scale rule the HTTP
    //    write path applies, called with the same arguments, and it accepts fewer than
    //    two bands — which is what keeps a school able to build a scale one band at a
    //    time through this command as well.
    const bands = await bandsOf(gradingScaleId);
    const editedId = bands.find((candidate) => candidate.key === key)?.id ?? null;
    const band: ImportBand = {
      id: editedId ?? `${DOCUMENT_BAND_ID}${gradingScaleId}/${key}`,
      key,
      minScore: parsed.data.minScore,
      maxScore: parsed.data.maxScore,
      order: parsed.data.order,
    };
    const survivors = bands.filter((candidate) => candidate.id !== editedId);

    const conflicts = gradeBandWriteProblems({ write: band, stored: survivors, editedId });
    if (conflicts.length > 0) {
      record("GradingLevel", "skipped");
      problems.push(`GradingLevel ${scaleName}/${key}: ${conflicts.join("; ")}`);
      continue;
    }

    // 5. `order` is `@@unique([gradingScaleId, order])` for the same reason `key` is:
    //    the report renders the band that comes first, so two bands at one position
    //    make the winner a function of row order. Judged over the merged set, because
    //    the collision that matters may be with a band already stored.
    const positions = GradingLevelPositionSetSchema.safeParse(
      [...survivors, band].map((entry) => ({ key: entry.key, order: entry.order })),
    );
    if (!positions.success) {
      record("GradingLevel", "skipped");
      problems.push(`GradingLevel ${scaleName}/${key}: ${zodIssues(positions.error)}`);
      continue;
    }

    // Replace rather than append. `band` carries `editedId`, so appending it to a list
    // that still holds the stored row would leave the scale holding that band twice, and
    // the NEXT row in the document would be judged against a duplicate of the band just
    // replaced — reporting a conflict between a band and itself.
    const replaced = bands.findIndex((candidate) => candidate.id === editedId);
    if (replaced === -1) bands.push(band);
    else bands[replaced] = band;

    const where = { gradingScaleId_key: { gradingScaleId, key } };
    const existing = await tx.gradingLevel.findUnique({ where, select: { id: true } });
    const createOnly = existing === null;
    const data = {
      label: parsed.data.label,
      minScore: parsed.data.minScore,
      maxScore: parsed.data.maxScore,
      color: parsed.data.color,
      description: parsed.data.description,
      order: parsed.data.order,
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

/**
 * Whether a scale is this tenant's and this school's to hang bands from.
 *
 * The predicate is `gradingScaleScopeWhere` — the one
 * `gradingScaleParentScopeWriteRule` hands the HTTP write path — read here rather than
 * retyped, so the two paths cannot drift apart on what a caller owns. `schoolId: null`
 * counts, because a tenant-wide scale is a legitimate parent shared by every school in
 * the tenant, and refusing it would refuse every band written against a shared scale.
 */
async function ownsScale(
  tx: Prisma.TransactionClient,
  gradingScaleId: string,
  scope: Scope,
): Promise<boolean> {
  const scale = await tx.gradingScale.findFirst({
    where: gradingScaleScopeWhere({
      id: gradingScaleId,
      tenantId: scope.tenantId,
      schoolId: scope.schoolId,
    }),
    select: { id: true },
  });
  return scale !== null;
}

/**
 * Zod's issues as one clause, so a refusal reads as one sentence naming the field an
 * operator would have to open. Deliberately not a throw: a row that fails here is
 * reported alongside every other skipped row, like a row with a missing parent.
 */
function zodIssues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}