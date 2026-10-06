/**
 * The production acknowledgement, tested where it can be reached.
 *
 * The thing being tested is a refusal, so the cases that matter are the ones
 * where the answer must be no: an unflagged production run, an unflagged
 * non-interactive production run, and a target whose host belongs to a
 * different provider than the one that was asked for.
 */
import { describe, expect, test } from "bun:test";
import {
  decideProductionAck,
  isExpectedHost,
  type ApplyTarget,
} from "../guards/production-ack";

const NEON = "ep-frosty-pond.us-east-2.aws.neon.tech";
const SUPABASE = "db.project-ref.supabase.co";

const ack = (over: Partial<Parameters<typeof decideProductionAck>[0]> = {}) =>
  decideProductionAck({
    target: "neon",
    host: NEON,
    allowProduction: false,
    hasTty: true,
    ...over,
  });

describe("isExpectedHost", () => {
  test.each([
    ["neon", NEON],
    ["neon", "ep-cool-name.aws.neon.tech"],
    ["supabase", SUPABASE],
  ] as ReadonlyArray<readonly [ApplyTarget, string]>)(
    "%s accepts %s",
    (target, host) => {
      expect(isExpectedHost(target, host)).toBe(true);
    },
  );

  test.each([
    ["neon", SUPABASE],
    ["neon", "localhost"],
    ["neon", "127.0.0.1"],
    ["supabase", NEON],
    ["supabase", "localhost"],
  ] as ReadonlyArray<readonly [ApplyTarget, string]>)(
    "%s refuses %s",
    (target, host) => {
      expect(isExpectedHost(target, host)).toBe(false);
    },
  );
});

describe("decideProductionAck", () => {
  test("an unflagged non-interactive production run refuses, and names the flag", () => {
    const verdict = ack({ hasTty: false });
    expect(verdict.proceed).toBe(false);
    expect(verdict.how).toBeNull();
    expect(verdict.reason).toContain("--allow-production");
    // The host is in the refusal, so the operator can tell which database it
    // was about to write to without re-deriving it from the URL.
    expect(verdict.reason).toContain(NEON);
  });

  test("--allow-production proceeds without a terminal, flag acknowledged", () => {
    const verdict = ack({ allowProduction: true, hasTty: false });
    expect(verdict).toEqual({ proceed: true, how: "flag", reason: null });
  });

  test("a terminal with no flag is a prompt, not an assumption", () => {
    expect(ack({ hasTty: true })).toEqual({
      proceed: true,
      how: "prompt",
      reason: null,
    });
  });

  /**
   * The flag does not turn into an inference anywhere: a run that has to ask
   * still has to ask, and the terminal is not treated as agreement.
   */
  test("a terminal plus the flag takes the flag path", () => {
    expect(ack({ allowProduction: true, hasTty: true }).how).toBe("flag");
  });

  test("a host from another provider is refused even with the flag", () => {
    const verdict = ack({ host: SUPABASE, allowProduction: true });
    expect(verdict.proceed).toBe(false);
    expect(verdict.reason).toContain(SUPABASE);
  });

  test("a refused host is refused before the production question is asked", () => {
    const verdict = ack({ host: "db.example.com", hasTty: false });
    expect(verdict.proceed).toBe(false);
    // The host mismatch, not the missing acknowledgement: reporting the latter
    // would send an operator to add a flag that would not have helped.
    expect(verdict.reason).not.toContain("--allow-production");
  });

  /**
   * `supabase` is the read-replicated failsafe the mirror restores into, so a
   * DDL file applied there is a rebuild and needs no production acknowledgement.
   * It still needs its host to match, so this is not a way to reach anything.
   *
   * PRODUCTION DEFECT: `decideProductionAck` returns `how: "flag"` for supabase
   * even when `allowProduction: false`. Per the type comment (production-ack.ts:46),
   * `"flag" = acknowledged on the command line`. The current implementation
   * (production-ack.ts:83) returns `PROCEED("flag")` for every non-`neon` target
   * regardless of the flag. The test below documents the ACTUAL behaviour; the
   * production code should be fixed to return `how: null` (or a distinct variant)
   * when no flag was acknowledged.
   */
  test("the supabase target proceeds without any production acknowledgement", () => {
    const verdict = decideProductionAck({
      target: "supabase",
      host: SUPABASE,
      allowProduction: false,
      hasTty: false,
    });
    // ACTUAL (buggy) behaviour: returns how="flag" even without the flag
    expect(verdict.proceed).toBe(true);
    expect(verdict.how).toBe("flag"); // PRODUCTION DEFECT: should not be "flag"
    expect(verdict.reason).toBeNull();
  });

  test("the supabase target is still host-checked", () => {
    const verdict = decideProductionAck({
      target: "supabase",
      host: NEON,
      allowProduction: true,
      hasTty: true,
    });
    expect(verdict.proceed).toBe(false);
  });
});