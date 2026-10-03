/**
 * `clone` never copies data about people.
 *
 * The assertions are made against the recorded Prisma calls rather than against
 * a hand-written list, so adding a model to `NEVER_CLONED` and then also
 * adding it to `CLONE_STEPS` fails here rather than in a production database.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeDatabase, installFakeDatabase } from "./support/fake-prisma";

const fake = new FakeDatabase();
await installFakeDatabase(fake);

const { CLONE_STEPS, NEVER_CLONED, cloneConfiguration } = await import("../commands/clone");

const SOURCE_TENANT = "tenant_source";
const TARGET_TENANT = "tenant_target";
const SOURCE_SCHOOL = "school_source";
const TARGET_SCHOOL = "school_target";

function seedSource(): void {
  fake.seed("permission", { tenantId_key: { tenantId: SOURCE_TENANT, key: "system:manage" } }, {
    id: "perm_1",
    tenantId: SOURCE_TENANT,
    schoolId: null,
    key: "system:manage",
    description: "Manage system settings",
    category: "system",
    resource: "system",
    action: "manage",
    scope: "all",
    isSystem: true,
  });

  fake.seed("role", { tenantId_schoolId_name: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, name: "HEADMASTER" } }, {
    id: "role_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    name: "HEADMASTER",
    description: "School Head",
    isSystem: true,
    permissions: ["system:manage"],
    inheritsFrom: [],
  });

  fake.seed("classLevel", { tenantId_schoolId_code: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, code: "CRECHE" } }, {
    id: "level_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    code: "CRECHE",
    name: "Creche",
    phase: "KINDERGARTEN",
    order: 1,
    ageMin: 2,
    ageMax: 4,
  });

  fake.seed("subject", { tenantId_schoolId_code: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, code: "ENG" } }, {
    id: "subject_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    code: "ENG",
    name: "English",
    category: "LANGUAGE",
    isCore: true,
    creditHours: 1,
    description: null,
    color: null,
  });

  fake.seed("subjectLevel", { tenantId_subjectId_classLevelId: { tenantId: SOURCE_TENANT, subjectId: "subject_1", classLevelId: "level_1" } }, {
    id: "subjectlevel_1",
    tenantId: SOURCE_TENANT,
    subjectId: "subject_1",
    classLevelId: "level_1",
    isRequired: true,
    periodsPerWeek: 5,
  });

  fake.seed("gradingScale", { tenantId_schoolId_name: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, name: "Ghana" } }, {
    id: "scale_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    name: "Ghana",
    description: null,
    isDefault: true,
    appliesToLevels: ["JHS"],
  });
  // A tenant-scoped scale: reported as skipped rather than silently dropped.
  fake.seed("gradingScale", { tenantId_schoolId_name: { tenantId: SOURCE_TENANT, schoolId: null, name: "Shared" } }, {
    id: "scale_shared",
    tenantId: SOURCE_TENANT,
    schoolId: null,
    name: "Shared",
    description: null,
    isDefault: false,
    appliesToLevels: [],
  });

  fake.seed("gradingLevel", { gradingScaleId_key: { gradingScaleId: "scale_1", key: "A" } }, {
    id: "gradering_1",
    tenantId: SOURCE_TENANT,
    gradingScaleId: "scale_1",
    key: "A",
    label: "A",
    minScore: 80,
    maxScore: 100,
    point: "1.0",
    color: "#059669",
    description: null,
    order: 1,
  });

  fake.seed("feeCategory", { tenantId_schoolId_code: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, code: "TUITION" } }, {
    id: "fee_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    code: "TUITION",
    name: "Tuition",
    isRecurring: true,
    defaultMandatory: true,
    sortOrder: 1,
  });

  fake.seed("paymentMethodConfig", { tenantId_schoolId_code: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, code: "MOMO" } }, {
    id: "pm_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    code: "MOMO",
    name: "Mobile Money",
    instructions: null,
    isEnabled: true,
    sortOrder: 1,
    providerConfig: null,
  });

  fake.seed("assessmentTypeConfig", { tenantId_schoolId_code: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, code: "EXAM" } }, {
    id: "at_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    code: "EXAM",
    name: "End of Term Exam",
    description: null,
    defaultWeight: "1.0",
    maxScore: 100,
    appliesToLevels: [],
    isActive: true,
  });

  fake.seed("house", { tenantId_schoolId_name: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL, name: "Red" } }, {
    id: "house_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    name: "Red",
    color: "#dc2626",
    motto: null,
    patronId: "staff_1",
  });

  fake.seed("branding", { tenantId_schoolId: { tenantId: SOURCE_TENANT, schoolId: SOURCE_SCHOOL } }, {
    id: "branding_1",
    tenantId: SOURCE_TENANT,
    schoolId: SOURCE_SCHOOL,
    name: "Another Montessori School",
    logoUrl: null,
    faviconUrl: null,
    primaryColor: "#059669",
    secondaryColor: "#0891b2",
    accentColor: "#d97706",
    motto: null,
    address: null,
    phone: null,
    email: null,
    website: null,
    socialLinks: null,
  });

  fake.seed("configEntity", { tenantId_type: { tenantId: SOURCE_TENANT, type: "subject" } }, {
    id: "ce_1",
    tenantId: SOURCE_TENANT,
    schoolId: null,
    type: "subject",
    name: "Subject",
    namePlural: "Subjects",
    description: null,
    icon: null,
    color: null,
    definition: { fields: [] },
    isActive: true,
    isSystem: true,
  });

  // Real-person and real-money rows that exist in the source and must survive
  // the clone untouched in the source and absent from the target.
  for (const model of ["Student", "Staff", "Payment", "FeeInvoice", "AttendanceStudent", "AttendanceStaff"]) {
    fake.seed(model, { id: `${model}_1` }, {
      id: `${model}_1`,
      tenantId: SOURCE_TENANT,
      schoolId: SOURCE_SCHOOL,
      email: "person@example.com",
    });
  }
}

function request(dryRun = false): Parameters<typeof cloneConfiguration>[1] {
  return {
    sourceCode: "another",
    targetCode: "target",
    sourceTenantId: SOURCE_TENANT,
    targetTenantId: TARGET_TENANT,
    sourceSchoolId: SOURCE_SCHOOL,
    targetSchoolId: TARGET_SCHOOL,
    dryRun,
  };
}

beforeEach(() => {
  fake.reset();
  seedSource();
});

describe("NEVER_CLONED", () => {
  test("contains every model the plan names as a privacy boundary", () => {
    for (const model of [
      "User",
      "Student",
      "Staff",
      "Payment",
      "FeeInvoice",
      "AttendanceStudent",
      "AttendanceStaff",
      "Message",
      "Notification",
      "Session",
      "Account",
    ]) {
      expect(NEVER_CLONED.has(model)).toBe(true);
    }
  });

  test("no model on the copy list is also on the denylist", () => {
    for (const model of CLONE_STEPS) {
      expect(NEVER_CLONED.has(model)).toBe(false);
    }
  });

  test("the copy list is not empty and has no duplicates", () => {
    expect(CLONE_STEPS.length).toBeGreaterThan(0);
    expect(new Set(CLONE_STEPS).size).toBe(CLONE_STEPS.length);
  });
});

describe("cloneConfiguration", () => {
  test("never touches a model on the denylist, not even to read it", async () => {
    await cloneConfiguration(fake.transactionClient() as never, request());

    const touched = fake.touchedModels;
    for (const model of NEVER_CLONED) {
      expect(touched).not.toContain(model);
    }
  });

  test("touches only models on the copy list", async () => {
    await cloneConfiguration(fake.transactionClient() as never, request());

    for (const model of fake.touchedModels) {
      expect(CLONE_STEPS).toContain(model);
    }
  });

  test("copies no rows into any denylisted model", async () => {
    const before = Object.fromEntries(
      [...NEVER_CLONED].map((model) => [model, fake.countOf(model)]),
    );
    expect(Object.values(before).some((count) => count > 0)).toBe(true);

    await cloneConfiguration(fake.transactionClient() as never, request());

    for (const [model, count] of Object.entries(before)) {
      expect(fake.countOf(model)).toBe(count);
      for (const row of fake.rowsOf(model)) {
        expect(row.tenantId).toBe(SOURCE_TENANT);
      }
    }
  });

  test("writes nothing into the target for a denylisted model", async () => {
    await cloneConfiguration(fake.transactionClient() as never, request());

    for (const model of NEVER_CLONED) {
      for (const row of fake.rowsOf(model)) {
        expect(row.tenantId).not.toBe(TARGET_TENANT);
      }
    }
  });

  test("every copy-list model is reported, whether or not it had rows", async () => {
    const report = await cloneConfiguration(fake.transactionClient() as never, request());

    expect(report.models.map((entry) => entry.model)).toEqual([...CLONE_STEPS]);
    expect(report.totals.created).toBe(
      report.models.reduce((sum, entry) => sum + entry.created, 0),
    );
  });

  test("copies configuration with ids remapped onto the target", async () => {
    const report = await cloneConfiguration(fake.transactionClient() as never, request());

    expect(report.dryRun).toBe(false);
    expect(report.totals.created).toBeGreaterThan(0);

    const targetSubjects = fake.rowsOf("subject").filter((row) => row.tenantId === TARGET_TENANT);
    expect(targetSubjects).toHaveLength(1);
    expect(targetSubjects[0].code).toBe("ENG");
    expect(targetSubjects[0].schoolId).toBe(TARGET_SCHOOL);
    // The new row has a new id; the mapping must point at it.
    expect(targetSubjects[0].id).not.toBe("subject_1");

    const targetSubjectLevels = fake.rowsOf("subjectLevel").filter((row) => row.tenantId === TARGET_TENANT);
    expect(targetSubjectLevels).toHaveLength(1);
    expect(targetSubjectLevels[0].subjectId).toBe(targetSubjects[0].id);
    expect(targetSubjectLevels[0].classLevelId).not.toBe("level_1");

    const targetLevels = fake.rowsOf("gradingLevel").filter((row) => row.tenantId === TARGET_TENANT);
    expect(targetLevels).toHaveLength(1);
    expect(targetLevels[0].gradingScaleId).not.toBe("scale_1");
  });

  test("drops House.patronId, which points at a row that does not exist in the target", async () => {
    await cloneConfiguration(fake.transactionClient() as never, request());
    const targetHouses = fake.rowsOf("house").filter((row) => row.tenantId === TARGET_TENANT);
    expect(targetHouses).toHaveLength(1);
    expect(targetHouses[0].patronId).toBeNull();
  });

  test("reports a tenant-scoped grading scale as skipped rather than dropping it silently", async () => {
    const report = await cloneConfiguration(fake.transactionClient() as never, request());
    const scale = report.models.find((entry) => entry.model === "GradingScale");
    expect(scale?.skipped).toBe(1);
    expect(scale?.created).toBe(1);
  });

  test("never overwrites a target row that is system-owned", async () => {
    fake.seed("configEntity", { tenantId_type: { tenantId: TARGET_TENANT, type: "subject" } }, {
      id: "target_ce",
      tenantId: TARGET_TENANT,
      schoolId: null,
      type: "subject",
      name: "Locally renamed Subject",
      namePlural: "Subjects",
      description: "Edited by the target administrator",
      icon: null,
      color: null,
      definition: { fields: ["local"] },
      isActive: true,
      isSystem: true,
    });

    const report = await cloneConfiguration(fake.transactionClient() as never, request());

    const row = fake.rowsOf("configEntity").find((candidate) => candidate.tenantId === TARGET_TENANT);
    expect(row?.name).toBe("Locally renamed Subject");
    expect(report.models.find((entry) => entry.model === "ConfigEntity")?.skipped).toBe(1);
  });

  test("never writes isSystem on the update branch", async () => {
    fake.seed("configEntity", { tenantId_type: { tenantId: TARGET_TENANT, type: "subject" } }, {
      id: "target_ce",
      tenantId: TARGET_TENANT,
      schoolId: null,
      type: "subject",
      name: "Subject",
      namePlural: "Subjects",
      description: null,
      icon: null,
      color: null,
      definition: { fields: [] },
      isActive: true,
      isSystem: false,
    });

    await cloneConfiguration(fake.transactionClient() as never, request());

    const row = fake.rowsOf("configEntity").find((candidate) => candidate.tenantId === TARGET_TENANT);
    expect(row?.isSystem).toBe(false);
  });

  test("a dry run reads everything and writes nothing", async () => {
    const report = await cloneConfiguration(fake.transactionClient() as never, request(true));

    expect(report.dryRun).toBe(true);
    expect(report.totals.created).toBeGreaterThan(0);
    expect(fake.callsTo("subject", "upsert")).toHaveLength(0);
    expect(fake.callsTo("classLevel", "upsert")).toHaveLength(0);
    expect(fake.rowsOf("subject").filter((row) => row.tenantId === TARGET_TENANT)).toHaveLength(0);
  });

  test("running twice converges instead of duplicating", async () => {
    await cloneConfiguration(fake.transactionClient() as never, request());
    const afterFirst = fake.countOf("subject");

    const second = await cloneConfiguration(fake.transactionClient() as never, request());

    expect(fake.countOf("subject")).toBe(afterFirst);
    expect(second.totals.created).toBe(0);
    expect(second.totals.updated).toBeGreaterThan(0);
  });
});