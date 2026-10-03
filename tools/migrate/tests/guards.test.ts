/**
 * Guards. The interesting property of every guard here is what it does when it
 * *cannot* run, so those cases are pinned as carefully as the happy paths.
 */
import { describe, expect, test } from "bun:test";
import { classifyTarget, type ClassifyOptions } from "../guards/refuse-production";
import type { Target } from "../env";
import { confirm } from "../guards/confirm";
import { evaluateMirrorAge, type AgeVerdict } from "../guards/require-backup";
import { assertDevOnlyTarget } from "../commands/reset";
import { compareLedger, type LedgerRow } from "../commands/status";
import { planBaseline } from "../commands/baseline";

const target = (host: string): Target => ({
  kind: "primary",
  url: `postgresql://u:p@${host}:5432/d`,
  source: "DATABASE_URL",
  host,
});

describe("classifyTarget", () => {
  const noOpts: ClassifyOptions = {};

  test("a local host is never production", () => {
    expect(classifyTarget(target("localhost"), noOpts).production).toBe(false);
    expect(classifyTarget(target("127.0.0.1"), noOpts).production).toBe(false);
  });

  test("an unrecognised remote host is production", () => {
    const verdict = classifyTarget(target("ep-x.us-east-2.aws.neon.tech"), noOpts);
    expect(verdict.production).toBe(true);
    expect(verdict.reason).toContain("unrecognised hosts are treated as production");
  });

  test("--target prod beats a local host", () => {
    expect(classifyTarget(target("localhost"), { declared: "prod" }).production).toBe(true);
  });

  test("--target dev is the only way to declare a remote host safe, and it is recorded", () => {
    const verdict = classifyTarget(target("db.example.com"), { declared: "dev" });
    expect(verdict.production).toBe(false);
    expect(verdict.reason).toContain("db.example.com");
  });
});

describe("reset locks", () => {
  test("refuses without --dev-only even against localhost", () => {
    expect(() => assertDevOnlyTarget(target("localhost"), false)).toThrow(/--dev-only/);
  });

  test("refuses a remote host even with --dev-only", () => {
    expect(() => assertDevOnlyTarget(target("db.example.com"), true)).toThrow(
      /not a local address/,
    );
  });

  test("allows localhost with --dev-only", () => {
    expect(() => assertDevOnlyTarget(target("127.0.0.1"), true)).not.toThrow();
  });
});

describe("confirm", () => {
  const noTty = { isTTY: false } as unknown as NodeJS.ReadStream;

  test("--yes accepts without any TTY", async () => {
    expect(await confirm("go?", { yes: true })).toBe(true);
  });

  test("no TTY and no --yes declines instead of blocking", async () => {
    expect(await confirm("go?", { yes: false, input: noTty })).toBe(false);
  });

  test("an input stream that closes without a line declines", async () => {
    const { Readable } = await import("node:stream");
    const closed = Readable.from([]) as unknown as NodeJS.ReadStream;
    (closed as { isTTY: boolean }).isTTY = true;
    expect(await confirm("go?", { yes: false, input: closed, timeoutMs: 1000 })).toBe(false);
  });
});

describe("evaluateMirrorAge", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  /** Narrows the union so the failure reasons can be asserted. */
  const refusal = (v: AgeVerdict): { ageHours: number | null; reason: string } => {
    if (v.ok) throw new Error(`expected a refusal, got age ${v.ageHours}`);
    return { ageHours: v.ageHours, reason: v.reason };
  };

  test("an unknown age is not silently fine — it is labelled", () => {
    const r = refusal(evaluateMirrorAge(undefined, now, 24));
    expect(r.ageHours).toBeNull();
    expect(r.reason).toContain("no mirror timestamp");
  });

  test("a fresh ledger timestamp passes", () => {
    const verdict = evaluateMirrorAge("2026-10-03T10:00:00Z", now, 24);
    expect(verdict.ok).toBe(true);
    expect(verdict.ageHours).toBeCloseTo(2, 5);
  });

  test("a stale one refuses and says to run the mirror", () => {
    expect(refusal(evaluateMirrorAge(new Date("2026-09-01T00:00:00Z"), now, 24)).reason).toContain(
      "db:mirror",
    );
  });

  test("a future timestamp is a refusal, not a pass", () => {
    expect(evaluateMirrorAge("2026-10-04T00:00:00Z", now, 24).ok).toBe(false);
  });

  test("garbage is a refusal", () => {
    expect(evaluateMirrorAge("not a date", now, 24).ok).toBe(false);
  });
});

describe("compareLedger", () => {
  const row = (name: string, over: Partial<LedgerRow> = {}): LedgerRow => ({
    migration_name: name,
    started_at: "2026-09-29T00:00:00Z",
    finished_at: "2026-09-29T00:00:01Z",
    rolled_back_at: null,
    applied_steps_count: 1,
    logs: null,
    ...over,
  });

  const ON_DISK = ["20260929000000_init", "20261002103000_platform_config"];

  test("no ledger at all means everything is pending and the state has drifted", () => {
    const result = compareLedger(ON_DISK, undefined);
    expect(result.pending).toEqual(ON_DISK);
    expect(result.hasFailed).toBe(false);
    expect(result.drifted).toBe(true);
  });

  test("an empty repository and no ledger is not drift", () => {
    expect(compareLedger([], undefined).drifted).toBe(false);
  });

  test("a half-applied migration is a failure, not a pending one", () => {
    const result = compareLedger(ON_DISK, [
      row(ON_DISK[0] as string),
      row(ON_DISK[1] as string, { finished_at: null }),
    ]);
    expect(result.failed).toEqual([ON_DISK[1]]);
    expect(result.hasFailed).toBe(true);
    // Crucially not also "pending": a second deploy would try it again.
    expect(result.pending).toEqual([]);
  });

  test("a rolled-back migration is settled, so Prisma will not re-run it", () => {
    const result = compareLedger(ON_DISK, [
      row(ON_DISK[0] as string),
      row(ON_DISK[1] as string, { finished_at: null, rolled_back_at: "2026-10-01T00:00:00Z" }),
    ]);
    expect(result.rolledBack).toEqual([ON_DISK[1]]);
    expect(result.pending).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.drifted).toBe(false);
  });

  test("history the repository no longer has is drift", () => {
    const result = compareLedger([ON_DISK[0] as string], [
      row(ON_DISK[0] as string),
      row(ON_DISK[1] as string),
    ]);
    expect(result.unknown).toEqual([ON_DISK[1]]);
    expect(result.drifted).toBe(true);
  });

  test("a fully applied repository is in sync", () => {
    const result = compareLedger(ON_DISK, ON_DISK.map((n) => row(n)));
    expect(result.applied).toEqual(ON_DISK);
    expect(result.drifted).toBe(false);
  });
});

describe("planBaseline", () => {
  const ON_DISK = ["20260929000000_init", "20261002103000_platform_config"];

  test("defaults to every migration the ledger has not settled", () => {
    expect(planBaseline(ON_DISK, undefined, []).toResolve).toEqual(ON_DISK);
  });

  test("skips what is already recorded", () => {
    const ledger = [
      {
        migration_name: ON_DISK[0] as string,
        started_at: null,
        finished_at: "x",
        rolled_back_at: null,
        applied_steps_count: 1,
        logs: null,
      },
    ];
    expect(planBaseline(ON_DISK, ledger, []).toResolve).toEqual([ON_DISK[1]]);
  });

  test("refuses a migration that is not on disk rather than inventing it", () => {
    expect(() => planBaseline(ON_DISK, undefined, ["20261111000000_nope"])).toThrow(
      /no such migration on disk/,
    );
  });

  test("an explicit list is honoured and sorted, oldest first", () => {
    const plan = planBaseline(ON_DISK, undefined, [ON_DISK[1] as string, ON_DISK[0] as string]);
    expect(plan.toResolve).toEqual(ON_DISK);
  });
});
