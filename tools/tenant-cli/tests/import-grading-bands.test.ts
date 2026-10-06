/**
 * `import` refuses a grading band the HTTP write path would refuse.
 *
 * The import is how a school is brought onboard, so it is the last place a band can be
 * wrong before anyone looks at it: a scale that runs backwards, leaves 0-100, or lets
 * two bands claim one percentage makes the winning band a function of row order rather
 * than of the score, and the child it lands on is reported under a band nobody chose.
 * The API refuses those writes through `gradeBandWriteProblems` and
 * `GradingLevelCreateSchema`; before this change the CLI applied the same rows with no
 * band or colour validation at all, so a document could carry a scale the API would
 * never accept.
 *
 * The refusals are asserted the way the command reports them — the row is counted
 * `skipped`, a sentence naming the fault lands on `problems`, and nothing is written —
 * because that IS the contract an operator reads. A refusal that threw, or that rolled
 * the document back, would be a different command.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { FakeDatabase, installFakeDatabase } from "./support/fake-prisma";
import type { ExportedModels } from "../commands/config/export";

const fake = new FakeDatabase();
await installFakeDatabase(fake);

const { applyDocument } = await import("../commands/import");

const TENANT = "tenant_ghana";
const SCHOOL = "school_north";
const OTHER_SCHOOL = "school_south";
const SCALE = "Ghana Primary";
const SCALE_ID = "scale_north";

type Band = Record<string, unknown>;

/** The seeded Ghana Primary scale, the shape a school actually reports on. */
const PRIMARY: Band[] = [
  { key: "level_1", label: "Level 1", minScore: 0, maxScore: 39, color: "#dc2626", order: 1 },
  { key: "level_2", label: "Level 2", minScore: 40, maxScore: 49, color: "#ea580c", order: 2 },
  { key: "level_3", label: "Level 3", minScore: 50, maxScore: 59, color: "#ca8a04", order: 3 },
  { key: "level_4", label: "Level 4", minScore: 60, maxScore: 69, color: "#16a34a", order: 4 },
  { key: "level_5", label: "Level 5", minScore: 70, maxScore: 84, color: "#0284c7", order: 5 },
  { key: "level_6", label: "Level 6", minScore: 85, maxScore: 100, color: "#047857", order: 6 },
];

function document(bands: readonly Band[], scaleRows: readonly Band[] = [{}]): ExportedModels {
  return {
    permissions: [],
    roles: [],
    classLevels: [],
    subjects: [],
    subjectLevels: [],
    gradingScales: scaleRows.map((extra) => ({
      name: SCALE,
      description: null,
      isDefault: true,
      appliesToLevels: ["PRIMARY"],
      ...extra,
    })),
    gradingLevels: bands.map((band) => ({ scale: SCALE, description: null, ...band })),
    feeCategories: [],
    paymentMethods: [],
    assessmentTypes: [],
    houses: [],
    branding: null,
    configEntities: [],
  };
}

/** The primary scale with `key`'s row amended, rather than replaced. */
function primaryWith(key: string, changes: Band): Band[] {
  return PRIMARY.map((row) => (row.key === key ? { ...row, ...changes, key } : row));
}

function apply(
  config: ExportedModels,
  options: { dryRun?: boolean; schoolId?: string } = {},
): ReturnType<typeof applyDocument> {
  return applyDocument(fake.transactionClient() as never, config, {
    tenantId: TENANT,
    schoolId: options.schoolId ?? SCHOOL,
    dryRun: options.dryRun ?? false,
  });
}

function bandsWrittenTo(scaleId: string): Band[] {
  return fake.rowsOf("gradingLevel").filter((row) => row.gradingScaleId === scaleId);
}

function problemFor(key: string, report: Awaited<ReturnType<typeof apply>>): string | undefined {
  return report.problems.find((problem) => problem.includes(`/${key}:`));
}

function seedNorthScale(): void {
  fake.seed(
    "gradingScale",
    { tenantId_schoolId_name: { tenantId: TENANT, schoolId: SCHOOL, name: SCALE } },
    {
      id: SCALE_ID,
      tenantId: TENANT,
      schoolId: SCHOOL,
      name: SCALE,
      description: null,
      isDefault: true,
      appliesToLevels: ["PRIMARY"],
    },
  );
}

/** A band already in the database, stored directly so it can predate any validation. */
function seedStoredBand(
  scaleId: string,
  id: string,
  band: Band,
  schoolId: string = SCHOOL,
): void {
  fake.seed(
    "gradingLevel",
    { gradingScaleId_key: { gradingScaleId: scaleId, key: band.key } },
    {
      id,
      tenantId: TENANT,
      gradingScaleId: scaleId,
      key: band.key,
      label: band.key,
      minScore: band.minScore,
      maxScore: band.maxScore,
      color: band.color ?? "#000000",
      description: null,
      order: band.order ?? 1,
      schoolId,
    },
  );
}

beforeEach(() => {
  fake.reset();
  seedNorthScale();
});

describe("a legitimate import still succeeds", () => {
  test("the Ghana Primary scale imports clean", async () => {
    const report = await apply(document(PRIMARY));

    expect(report.problems).toEqual([]);
    expect(report.total.skipped).toBe(0);
    expect(report.counts.GradingLevel).toEqual({ created: 6, updated: 0, skipped: 0 });

    const written = bandsWrittenTo(SCALE_ID);
    expect(written).toHaveLength(6);
    expect(written.map((row) => row.key).sort()).toEqual(PRIMARY.map((row) => row.key).sort());
    for (const row of written) {
      expect(row.tenantId).toBe(TENANT);
      expect(row.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test("a scale still being built, one band at a time, is not refused", async () => {
    // The whole reason the cross-row rule accepts fewer than two bands: `0-39` alone is
    // a hole and a valid bottom half of a scale. A per-row coverage rule would refuse
    // this document and make a scale unbuildable.
    const first = await apply(document([PRIMARY[0]!]));
    expect(first.problems).toEqual([]);
    expect(first.counts.GradingLevel).toEqual({ created: 1, updated: 0, skipped: 0 });

    const second = await apply(document(PRIMARY));
    expect(second.problems).toEqual([]);
    expect(second.counts.GradingLevel).toEqual({ created: 5, updated: 1, skipped: 0 });
    expect(bandsWrittenTo(SCALE_ID)).toHaveLength(6);
  });

  test("retuning one boundary of a stored band is not an overlap with itself", async () => {
    // The stored row is replaced, not judged beside itself. The first half of a correct
    // two-row retune leaves a hole, which the cross-row rule deliberately allows and
    // resolution refuses; what it must not report is the band conflicting with its own
    // previous range.
    seedStoredBand(SCALE_ID, "band_stored_4", { key: "level_4", minScore: 60, maxScore: 69, order: 4 });

    const report = await apply(document(primaryWith("level_4", { minScore: 60, maxScore: 64, order: 4 })));

    expect(report.problems).toEqual([]);
    expect(report.counts.GradingLevel).toEqual({ created: 5, updated: 1, skipped: 0 });
    const level4 = bandsWrittenTo(SCALE_ID).find((row) => row.key === "level_4");
    expect(level4?.minScore).toBe(60);
    expect(level4?.maxScore).toBe(64);
  });
});

describe("a band the API would refuse is refused here too, writing nothing", () => {
  test("a band that runs backwards", async () => {
    const report = await apply(document(primaryWith("level_5", { minScore: 84, maxScore: 70, order: 5 })));

    expect(problemFor("level_5", report)).toContain("minScore must be less than or equal to maxScore");
    expect(report.counts.GradingLevel?.skipped).toBe(1);
    expect(bandsWrittenTo(SCALE_ID).map((row) => row.key)).not.toContain("level_5");
    // The rest of the document is still applied: a refusal is a skipped row, not a
    // rollback, which is what a row with a missing parent already does.
    expect(bandsWrittenTo(SCALE_ID)).toHaveLength(5);
  });

  test("a band that leaves 0-100", async () => {
    const report = await apply(document(primaryWith("level_6", { minScore: 85, maxScore: 120, order: 6 })));

    expect(problemFor("level_6", report)).toContain("maxScore");
    expect(bandsWrittenTo(SCALE_ID).map((row) => row.key)).not.toContain("level_6");
  });

  test("a stored band that leaves 0-100 stops the scale from being written to", async () => {
    // Simulates an older database or a direct SQL edit: the stored row was never parsed
    // by the create schema, so the only thing that can name it is the whole-scale read.
    seedStoredBand(SCALE_ID, "band_stored_wide", { key: "legacy", minScore: -10, maxScore: 100, order: 1 });

    const report = await apply(document([PRIMARY[1]!]));

    expect(problemFor("level_2", report)).toContain("outside 0-100");
    expect(bandsWrittenTo(SCALE_ID)).toHaveLength(1);
  });

  test("two bands claiming the same percentage", async () => {
    // `gradeBandWriteProblems`, judged across the scale: both rows pass their own schema
    // and only the set makes the winner arbitrary.
    const report = await apply(document(primaryWith("level_5", { minScore: 40, maxScore: 100, order: 5 })));

    expect(problemFor("level_5", report)).toContain("both claim");
    expect(report.counts.GradingLevel?.skipped).toBe(1);
    expect(bandsWrittenTo(SCALE_ID).map((row) => row.key)).not.toContain("level_5");
  });

  test("a duplicate order", async () => {
    const report = await apply(document(primaryWith("level_3", { order: 1 })));

    expect(problemFor("level_3", report)).toContain('order 1 is already claimed by "level_1"');
    expect(bandsWrittenTo(SCALE_ID).map((row) => row.key)).not.toContain("level_3");
  });

  test("a duplicate order against a band already stored", async () => {
    // 40-49 does not overlap 0-39, so the order is the only fault and the message can be
    // read as being about the order.
    seedStoredBand(SCALE_ID, "band_stored_1", { key: "legacy", minScore: 40, maxScore: 49, order: 1 });

    const report = await apply(document([PRIMARY[0]!]));

    expect(problemFor("level_1", report)).toContain('order 1 is already claimed by "legacy"');
    expect(bandsWrittenTo(SCALE_ID)).toHaveLength(1);
  });

  test("a duplicate key in the document", async () => {
    const report = await apply(document([...PRIMARY, PRIMARY[0]!]));

    expect(problemFor("level_1", report)).toContain("the document claims this key twice");
    expect(report.total.created).toBe(6);
  });

  test("a colour the report cannot draw", async () => {
    const report = await apply(document(primaryWith("level_3", { color: "red" })));

    expect(problemFor("level_3", report)).toContain("color must be a hex colour");
    expect(bandsWrittenTo(SCALE_ID).map((row) => row.key)).not.toContain("level_3");
  });

  test("a percentage that is not a number", async () => {
    // The old `integer(row, "minScore") ?? 0` turned this into a band of 0-0: a
    // valid-looking row that claims no percentage at all.
    const report = await apply(document(primaryWith("level_4", { minScore: "60" })));

    expect(problemFor("level_4", report)).toContain("minScore");
    expect(bandsWrittenTo(SCALE_ID).map((row) => row.key)).not.toContain("level_4");
  });
});

describe("the parent scale is the target school's, never another one's", () => {
  /** Another school of the same tenant, with a scale of the same name. */
  function seedSouthScale(): void {
    fake.seed(
      "gradingScale",
      { tenantId_schoolId_name: { tenantId: TENANT, schoolId: OTHER_SCHOOL, name: SCALE } },
      {
        id: "scale_south",
        tenantId: TENANT,
        schoolId: OTHER_SCHOOL,
        name: SCALE,
        description: null,
        isDefault: false,
        appliesToLevels: ["JHS"],
      },
    );
    // A band that overlaps every percentage any school could import. If the whole-scale
    // read were scoped to the tenant rather than to the scale, this would refuse all
    // six rows and blame another school's band.
    fake.seed(
      "gradingLevel",
      { gradingScaleId_key: { gradingScaleId: "scale_south", key: "everything" } },
      {
        id: "band_south",
        tenantId: TENANT,
        gradingScaleId: "scale_south",
        key: "everything",
        label: "Everything",
        minScore: 0,
        maxScore: 100,
        color: "#000000",
        description: null,
        order: 1,
      },
    );
  }

  test("no band is written against another school's scale", async () => {
    seedSouthScale();

    const report = await apply(document(PRIMARY));

    expect(report.problems).toEqual([]);
    expect(bandsWrittenTo(SCALE_ID)).toHaveLength(6);
    expect(bandsWrittenTo("scale_south")).toHaveLength(1);
    for (const row of bandsWrittenTo("scale_south")) expect(row.key).toBe("everything");
  });

  test("another school's bands cannot refuse this school's", async () => {
    seedSouthScale();

    // `everything 0-100` on the south scale claims every percentage this document uses.
    // Scoped to the scale, it is not in the judgement at all: the import reports no
    // conflict, which is the same answer the HTTP write path gives for a scale the
    // caller cannot see.
    const report = await apply(document(PRIMARY));

    expect(report.problems).toEqual([]);
    expect(report.total.skipped).toBe(0);
    expect(bandsWrittenTo("scale_south")).toHaveLength(1);
  });

  test("a band stored on this school's scale IS in the judgement", async () => {
    seedSouthScale();
    seedStoredBand(SCALE_ID, "band_north_wide", { key: "legacy", minScore: 0, maxScore: 100, order: 9 });

    // The mirror image: the same overlap on a scale this school owns is refused, so the
    // scoping is doing the work rather than the read simply finding nothing.
    const report = await apply(document([PRIMARY[0]!]));

    expect(problemFor("level_1", report)).toContain("both claim");
    expect(bandsWrittenTo(SCALE_ID)).toHaveLength(1);
  });

  test("a band naming a scale the document did not carry is refused, writing nothing", async () => {
    seedSouthScale();

    const report = await apply({
      ...document([]),
      gradingScales: [],
      gradingLevels: [{ scale: SCALE, key: "level_1", minScore: 0, maxScore: 39, color: "#dc2626", order: 1 }],
    });

    expect(problemFor("level_1", report)).toContain("the scale was not in the document");
    expect(bandsWrittenTo(SCALE_ID)).toHaveLength(0);
    expect(bandsWrittenTo("scale_south")).toHaveLength(1);
  });
});

describe("a dry run refuses exactly what an applying import refuses", () => {
  test("writes nothing and still reports every fault", async () => {
    // The colour fault is per-row and the overlap is cross-row, so between them they
    // show that a plan runs the same two checks an applying import does. The overlap is
    // between two rows that are each individually sound — and both of them valid, since
    // a row refused for its colour never reaches the scale the next row is judged against.
    const report = await apply(
      document([
        { ...PRIMARY[0]!, color: "red" },
        { ...PRIMARY[1]!, minScore: 0, maxScore: 39 },
        { ...PRIMARY[2]!, minScore: 30 },
      ]),
      { dryRun: true },
    );

    expect(report.dryRun).toBe(true);
    expect(report.total.skipped).toBe(2);
    expect(report.problems.some((problem) => problem.includes("color must be a hex colour"))).toBe(true);
    expect(report.problems.some((problem) => problem.includes("both claim"))).toBe(true);
    expect(fake.callsTo("gradingLevel", "upsert")).toHaveLength(0);
  });

  test("plans a legitimate document without writing it", async () => {
    const report = await apply(document(PRIMARY), { dryRun: true });

    expect(report.problems).toEqual([]);
    expect(report.counts.GradingLevel).toEqual({ created: 6, updated: 0, skipped: 0 });
    expect(fake.callsTo("gradingLevel", "upsert")).toHaveLength(0);
  });
});