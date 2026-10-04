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
import { assertLocalPushTarget } from "../commands/push";
import { compareLedger, type LedgerRow } from "../commands/status";
import { planBaseline, assertBaselineQualified } from "../commands/baseline";

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

describe("push host guard", () => {
  /**
   * The single property ADR-023 rests on: there is no host this guard will let
   * `prisma db push` reach except a developer's own machine, and no flag that
   * turns it off. Each local spelling is listed because `isLocalHost` is an
   * allowlist — a spelling added there is a spelling accepted here.
   */
  test.each([
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.1.2.3",
    "::1",
    "0.0.0.0",
    "host.docker.internal",
    "LOCALHOST",
  ])("allows %s", (host) => {
    expect(() => assertLocalPushTarget(target(host))).not.toThrow();
  });

  test.each([
    "ep-frosty-pond.us-east-2.aws.neon.tech",
    "db.supabase.co",
    "db.example.com",
    "10.0.0.5",
    "192.168.1.20",
    "localhost.evil.com",
    "notlocalhost",
    "<unparseable>",
  ])("refuses %s", (host) => {
    expect(() => assertLocalPushTarget(target(host))).toThrow(/not a local address/);
  });

  /**
   * The error is the only thing an operator sees when this fires, so it has to
   * carry the host, the reason, and the command that does work.
   */
  test("the refusal names the host, the ledger, and the supported alternative", () => {
    let message = "";
    try {
      assertLocalPushTarget(target("ep-frosty-pond.us-east-2.aws.neon.tech"));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("ep-frosty-pond.us-east-2.aws.neon.tech");
    expect(message).toContain("_prisma_migrations");
    expect(message).toContain("db:migrate:deploy");
  });

  /**
   * The mirror is the failsafe database. The guard keys on the resolved host
   * rather than on the target's kind, so a *local* mirror is fine — that is a
   * developer's own copy of it — while a remote one, which is the case that
   * matters, is refused.
   */
  test("allows a local mirror and refuses a remote one", () => {
    const local: Target = {
      ...target("localhost"),
      kind: "mirror",
      source: "SUPABASE_DATABASE_URL",
    };
    expect(() => assertLocalPushTarget(local)).not.toThrow();

    const remote: Target = {
      ...target("db.project.supabase.co"),
      kind: "mirror",
      source: "SUPABASE_DATABASE_URL",
    };
    expect(() => assertLocalPushTarget(remote)).toThrow(/not a local address/);
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

  test("the bare form refuses rather than asserting the whole history", () => {
    // The regression this pins: `planBaseline(onDisk, ledger, [])` used to
    // resolve every unsettled migration, so `baseline --apply` asserted that
    // 20260929000000_init had run and every later deploy skipped it.
    expect(() => planBaseline(ON_DISK, undefined, [], false)).toThrow(
      /would assert that every migration on disk already ran/,
    );
  });

  test("the refusal says verify is not the check, and points at compose", () => {
    let message = "";
    try {
      planBaseline(ON_DISK, undefined, [], false);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("verify` is not a substitute");
    expect(message).toContain("compose");
  });

  test("the refusal names the migrations and both ways out", () => {
    let message = "";
    try {
      planBaseline(ON_DISK, undefined, [], false);
    } catch (err) {
      message = (err as Error).message;
    }
    for (const name of ON_DISK) expect(message).toContain(name);
    expect(message).toContain("--migration");
    expect(message).toContain("--assert-all");
  });

  test("the refusal needs no ledger, so it can fire before any connection", () => {
    // Same message with and without a ledger: the guard cannot depend on a value
    // that is only known after a database round trip.
    const withLedger = () => {
      try {
        planBaseline(
          ON_DISK,
          [{ migration_name: ON_DISK[0] as string, started_at: null, finished_at: "x", rolled_back_at: null, applied_steps_count: 1, logs: null }],
          [],
          false,
        );
        return "";
      } catch (err) {
        return (err as Error).message;
      }
    };
    expect(withLedger()).toBe(
      (() => {
        try {
          planBaseline(ON_DISK, undefined, [], false);
          return "";
        } catch (err) {
          return (err as Error).message;
        }
      })(),
    );
  });

  test("an explicit list is honoured and sorted, oldest first", () => {
    const plan = planBaseline(ON_DISK, undefined, [ON_DISK[1] as string, ON_DISK[0] as string], false);
    expect(plan.toResolve).toEqual(ON_DISK);
  });

  test("--assert-all resolves everything the ledger has not settled", () => {
    expect(planBaseline(ON_DISK, undefined, [], true).toResolve).toEqual(ON_DISK);
  });

  test("--assert-all skips what is already recorded", () => {
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
    expect(planBaseline(ON_DISK, ledger, [], true).toResolve).toEqual([ON_DISK[1]]);
  });

  test("a fully settled ledger still needs the assertion named, so nothing is asserted by accident", () => {
    const ledger = ON_DISK.map((n) => ({
      migration_name: n,
      started_at: null,
      finished_at: "x",
      rolled_back_at: null,
      applied_steps_count: 1,
      logs: null,
    }));
    expect(() => planBaseline(ON_DISK, ledger, [], false)).toThrow(/no --migration/);
  });

  test("refuses a migration that is not on disk rather than inventing it", () => {
    expect(() => planBaseline(ON_DISK, undefined, ["20261111000000_nope"], false)).toThrow(
      /no such migration on disk/,
    );
  });
});

describe("assertBaselineQualified", () => {
  const ON_DISK = ["20260929000000_init", "20261002103000_platform_config"];

  test("an empty repository has nothing to assert and needs no flag", () => {
    expect(() => assertBaselineQualified([], false, [])).not.toThrow();
  });

  test("a named migration needs no flag, and no name is invented either", () => {
    expect(() => assertBaselineQualified([ON_DISK[0] as string], false, ON_DISK)).not.toThrow();
    expect(() => assertBaselineQualified(["nope"], false, ON_DISK)).not.toThrow();
  });

  test("--assert-all alone is enough", () => {
    expect(() => assertBaselineQualified([], true, ON_DISK)).not.toThrow();
  });

  test("the bare form is refused even when the ledger already settles everything", () => {
    // The dangerous case is exactly this one: a ledger that looks complete still
    // leaves the bare form able to record the next migration nobody checked.
    expect(() => assertBaselineQualified([], false, ON_DISK)).toThrow(
      /no honest undo/,
    );
  });
});
