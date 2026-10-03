/**
 * `config export` -- write a versionable JSON document of one tenant's
 * clonable configuration.
 *
 * The document contains exactly what `clone` copies and nothing else. That is
 * the point: an exported file is a thing people commit to a repository, so it
 * must not contain a person's name, address, phone number or password hash.
 * Every collection below is configuration, keyed by its natural key (a code or a
 * name) rather than by a database id, so the file stays valid after the source
 * tenant is renamed or re-seeded.
 */
import { writeFileSync } from "node:fs";
import { getPrisma } from "../../config";
import { out } from "../../output";
import { CLONE_STEPS } from "../clone";
import { ValidationError } from "../../validate";
import { resolveTenantCode, type ArgMap } from "../shared";

export const EXPORT_SCHEMA_ID = "novastar.tenant-config/v1";

export interface ExportedConfig {
  readonly $schema: typeof EXPORT_SCHEMA_ID;
  readonly exportedAt: string;
  readonly source: { readonly tenant: string; readonly school: string };
  readonly config: ExportedModels;
}

export interface ExportedModels {
  readonly permissions: readonly Record<string, unknown>[];
  readonly roles: readonly Record<string, unknown>[];
  readonly classLevels: readonly Record<string, unknown>[];
  readonly subjects: readonly Record<string, unknown>[];
  readonly subjectLevels: readonly Record<string, unknown>[];
  readonly gradingScales: readonly Record<string, unknown>[];
  readonly gradingLevels: readonly Record<string, unknown>[];
  readonly feeCategories: readonly Record<string, unknown>[];
  readonly paymentMethods: readonly Record<string, unknown>[];
  readonly assessmentTypes: readonly Record<string, unknown>[];
  readonly houses: readonly Record<string, unknown>[];
  readonly branding: Readonly<Record<string, unknown>> | null;
  readonly configEntities: readonly Record<string, unknown>[];
}

export const CONFIG_EXPORT_HELP = `Usage: novastar-tenant config export --out <file> [--tenant <code>] [--school <code>]

Writes a versionable JSON document containing everything \`clone\` copies and no
personal data. Reference it from a repository; feed it to \`novastar-tenant import\`.

Options:
  --tenant <code>   tenant code (default: TENANT_CODE)
  --school <code>   school code (default: the first school)
  --out <file>      destination path. Without it the document goes to stdout.
  --json            print a summary instead of the document`;

type Db = ReturnType<typeof getPrisma>;

export async function buildExport(
  db: Db,
  tenantCode: string,
  schoolCode: string | undefined,
): Promise<ExportedConfig> {
  const tenant = await db.tenant.findUnique({
    where: { code: tenantCode },
    select: {
      id: true,
      schools: { orderBy: { code: "asc" }, select: { id: true, code: true } },
    },
  });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${tenantCode}".` }]);
  }

  const school = schoolCode
    ? tenant.schools.find((candidate) => candidate.code === schoolCode)
    : tenant.schools[0];
  if (!school) {
    throw new ValidationError([
      { path: "--school", message: `Tenant ${tenantCode} has no matching school.` },
    ]);
  }

  const [permissions, roles, classLevels, subjects, subjectLevels, gradingScales, gradingLevels, feeCategories, paymentMethods, assessmentTypes, houses, brandings, configEntities] =
    await Promise.all([
      db.permission.findMany({ where: { tenantId: tenant.id }, orderBy: { key: "asc" } }),
      db.role.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { name: "asc" } }),
      db.classLevel.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { code: "asc" } }),
      db.subject.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { code: "asc" } }),
      db.subjectLevel.findMany({ where: { tenantId: tenant.id } }),
      db.gradingScale.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { name: "asc" } }),
      db.gradingLevel.findMany({ where: { tenantId: tenant.id } }),
      db.feeCategory.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { code: "asc" } }),
      db.paymentMethodConfig.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { code: "asc" } }),
      db.assessmentTypeConfig.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { code: "asc" } }),
      db.house.findMany({ where: { tenantId: tenant.id, schoolId: school.id }, orderBy: { name: "asc" } }),
      db.branding.findMany({ where: { tenantId: tenant.id, schoolId: school.id } }),
      db.configEntity.findMany({ where: { tenantId: tenant.id }, orderBy: { type: "asc" } }),
    ]);

  // Maps id -> natural key so the document has no foreign keys into another tenant.
  const subjectById = new Map(subjects.map((row) => [row.id, row.code]));
  const classLevelById = new Map(classLevels.map((row) => [row.id, row.code]));
  const scaleById = new Map(gradingScales.map((row) => [row.id, row.name]));

  const config: ExportedModels = {
    permissions: permissions.map((row) => ({
      key: row.key,
      description: row.description,
      category: row.category,
      resource: row.resource,
      action: row.action,
      scope: row.scope,
      isSystem: row.isSystem,
    })),
    roles: roles.map((row) => ({
      name: row.name,
      description: row.description,
      isSystem: row.isSystem,
      permissions: row.permissions,
      inheritsFrom: row.inheritsFrom,
    })),
    classLevels: classLevels.map((row) => ({
      code: row.code,
      name: row.name,
      phase: row.phase,
      order: row.order,
      ageMin: row.ageMin,
      ageMax: row.ageMax,
    })),
    subjects: subjects.map((row) => ({
      code: row.code,
      name: row.name,
      category: row.category,
      isCore: row.isCore,
      creditHours: row.creditHours,
      description: row.description,
      color: row.color,
    })),
    subjectLevels: subjectLevels
      .filter((row) => subjectById.has(row.subjectId) && classLevelById.has(row.classLevelId))
      .map((row) => ({
        subjectCode: subjectById.get(row.subjectId),
        classLevelCode: classLevelById.get(row.classLevelId),
        isRequired: row.isRequired,
        periodsPerWeek: row.periodsPerWeek,
      })),
    gradingScales: gradingScales.map((row) => ({
      name: row.name,
      description: row.description,
      isDefault: row.isDefault,
      appliesToLevels: row.appliesToLevels,
    })),
    gradingLevels: gradingLevels
      .filter((row) => scaleById.has(row.gradingScaleId))
      .map((row) => ({
        scale: scaleById.get(row.gradingScaleId),
        key: row.key,
        label: row.label,
        minScore: row.minScore,
        maxScore: row.maxScore,
        color: row.color,
        description: row.description,
        order: row.order,
      })),
    feeCategories: feeCategories.map((row) => ({
      code: row.code,
      name: row.name,
      isRecurring: row.isRecurring,
      defaultMandatory: row.defaultMandatory,
      sortOrder: row.sortOrder,
    })),
    paymentMethods: paymentMethods.map((row) => ({
      code: row.code,
      name: row.name,
      instructions: row.instructions,
      isEnabled: row.isEnabled,
      sortOrder: row.sortOrder,
      providerConfig: row.providerConfig,
    })),
    assessmentTypes: assessmentTypes.map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      defaultWeight: String(row.defaultWeight),
      maxScore: row.maxScore,
      appliesToLevels: row.appliesToLevels,
      isActive: row.isActive,
    })),
    houses: houses.map((row) => ({
      name: row.name,
      color: row.color,
      motto: row.motto,
    })),
    branding: brandings[0]
      ? {
          name: brandings[0].name,
          logoUrl: brandings[0].logoUrl,
          faviconUrl: brandings[0].faviconUrl,
          primaryColor: brandings[0].primaryColor,
          secondaryColor: brandings[0].secondaryColor,
          accentColor: brandings[0].accentColor,
          motto: brandings[0].motto,
          address: brandings[0].address,
          phone: brandings[0].phone,
          email: brandings[0].email,
          website: brandings[0].website,
          socialLinks: brandings[0].socialLinks,
        }
      : null,
    configEntities: configEntities.map((row) => ({
      type: row.type,
      scope: row.schoolId === school.id ? "school" : "tenant",
      name: row.name,
      namePlural: row.namePlural,
      description: row.description,
      icon: row.icon,
      color: row.color,
      definition: row.definition,
      isActive: row.isActive,
      isSystem: row.isSystem,
    })),
  };

  return {
    $schema: EXPORT_SCHEMA_ID,
    exportedAt: new Date().toISOString(),
    source: { tenant: tenantCode, school: school.code },
    config,
  };
}

export async function runConfigExport(args: ArgMap): Promise<void> {
  const tenantCode = resolveTenantCode(args);
  const document = await buildExport(getPrisma(), tenantCode, args.get("school"));
  const serialized = `${JSON.stringify(document, null, 2)}\n`;

  if (args.flag("json")) {
    out.json({
      schema: document.$schema,
      source: document.source,
      models: CLONE_STEPS,
      counts: Object.fromEntries(
        Object.entries(document.config).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.length : value === null ? 0 : 1,
        ]),
      ),
    });
    return;
  }

  const destination = args.get("out");
  if (!destination) {
    out.line(serialized.trimEnd());
    return;
  }

  writeFileSync(destination, serialized, "utf8");
  out.success(`Wrote ${destination}`);
}