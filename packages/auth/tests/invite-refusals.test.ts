/**
 * The refusals `createInvitedUser` reaches before it issues a statement.
 *
 * `createInvitedUser` checks the address, then narrows the role name, then applies
 * the privilege ceiling, and only after all three does it call `client`. Those
 * three refusals are therefore reachable with no database and no fake: the default
 * `client` is the module `prisma`, and reading that binding constructs no client,
 * so a refusal taken above the first query issues nothing whatever `DATABASE_URL`
 * happens to hold. Everything past the ceiling needs a Prisma client and is not
 * pinned here.
 *
 * The two properties worth pinning are the ordering and the silence. The ordering
 * is what stops an escalation attempt from learning whether the role it asked for
 * exists, and the silence is what keeps a refused address out of a log, a support
 * ticket and an error tracker.
 */
import { describe, expect, test } from "bun:test";
import {
  createInvitedUser,
  InviteError,
  type CreateInvitedUserInput,
  type GrantAuthority,
  type InviteFailure,
} from "../invite";

const school = (roleName: string | null): GrantAuthority => ({ kind: "school-role", roleName });
const OPERATOR: GrantAuthority = { kind: "platform-operator" };

/** A refusal, or a loud failure so a scan cannot pass on an empty transcript. */
async function refusalFor(
  overrides: Partial<CreateInvitedUserInput> & { email: string },
): Promise<InviteError> {
  const outcome = await createInvitedUser({
    tenantId: "tenant_test",
    schoolId: "school_test",
    roleName: "HEADMASTER",
    authority: OPERATOR,
    ...overrides,
  }).then(() => null, (error: unknown) => error);
  if (!(outcome instanceof InviteError)) {
    throw new Error(
      `expected an InviteError, got ${outcome === null ? "a resolved invite" : String(outcome)}`,
    );
  }
  return outcome;
}

/** Which refusal an address reaches. `unknown-role` means the shape gate let it through. */
async function reasonFor(email: string): Promise<InviteFailure> {
  return (await refusalFor({ email, roleName: "NOT_A_SEEDED_ROLE" })).reason;
}

// ---------------------------------------------------------------------------

describe("the address gate", () => {
  /**
   * `normaliseEmail` is "a deliberately loose shape check, not a parser" -- both
   * callers validate with zod first. These are the addresses it has to let through,
   * pinned so a tightening is a deliberate change rather than a surprise for a
   * caller whose own validation already accepted the address.
   */
  test.each([
    ["an ordinary address", "teacher@example.test"],
    ["an address with surrounding whitespace", "  padded@example.test  "],
    ["an address in mixed case", "Mixed.Case@Example.TEST"],
    ["an address with plus addressing", "teacher+school@example.test"],
    ["the shortest address the shape allows", "x@y"],
    ["an address of exactly 320 characters", `${"a".repeat(318)}@b`],
  ])("%s reaches the role check", async (_label, email) => {
    expect(await reasonFor(email)).toBe("unknown-role");
  });

  test.each([
    ["an empty address", ""],
    ["a whitespace-only address", "   "],
    ["an address with no @", "teacher.example.test"],
    ["an address with nothing before the @", "@example.test"],
    ["an address with nothing after the @", "teacher@"],
    ["an address with a space in it", "teacher @example.test"],
    ["an address with a tab in it", "teacher\t@example.test"],
    ["an address of 321 characters", `${"a".repeat(319)}@b`],
    ["an address far over the length limit", `${"a".repeat(4000)}@example.test`],
  ])("%s is refused before anything else", async (_label, email) => {
    expect(await reasonFor(email)).toBe("invalid-email");
  });
});

// ---------------------------------------------------------------------------

describe("the order of the refusals", () => {
  test("the address is checked before the role name, so a bad address is not reported as a bad role", async () => {
    // Both are wrong in the first case; which reason comes back says which check
    // runs first. The cheap local refusal must not be reported as the vocabulary one.
    expect((await refusalFor({ email: "no-at-sign", roleName: "NOT_A_SEEDED_ROLE" })).reason).toBe(
      "invalid-email",
    );
    expect((await refusalFor({ email: "no-at-sign", roleName: "HEADMASTER" })).reason).toBe("invalid-email");
    expect((await refusalFor({ email: "teacher@example.test", roleName: "NOT_A_SEEDED_ROLE" })).reason).toBe(
      "unknown-role",
    );
  });

  test("the ceiling is applied before the role is looked up, so an escalation attempt cannot enumerate the school's roles", async () => {
    // An ADMIN_STAFF account asking for HEADMASTER is refused with
    // `role-out-of-scope` whatever this school holds. Move the ceiling below the
    // lookup and the refusal becomes `role-not-in-school`, which answers a question
    // the caller was not entitled to ask; drop it and the call goes on to the insert.
    // Both changes fail on the reason asserted here.
    expect(
      (await refusalFor({ email: "a@example.test", roleName: "HEADMASTER", authority: school("ADMIN_STAFF") }))
        .reason,
    ).toBe("role-out-of-scope");
    // A caller with no rank of its own is refused the same way, and for the same
    // reason: there is nothing to compare, so nothing is granted.
    for (const roleName of ["   ", "", null, "SUPERADMIN", "__proto__"]) {
      expect(
        (await refusalFor({ email: "a@example.test", roleName: "HEADMASTER", authority: school(roleName) })).reason,
      ).toBe("role-out-of-scope");
    }
  });
});

// ---------------------------------------------------------------------------

describe("a refusal is safe to log", () => {
  const CANARY = "leakcanary-7f3a";

  test("a refused address is not echoed back, so it cannot reach a log", async () => {
    // Collected and scanned rather than compared to a fixed sentence, so the
    // property being pinned is the silence and not the wording.
    const transcripts: string[] = [];
    const messages: string[] = [];

    for (const bad of [
      CANARY,
      `${CANARY}@`,
      `has space ${CANARY}@example.test`,
      `${CANARY}${"a".repeat(321)}`,
    ]) {
      const err = await refusalFor({ email: bad });
      expect(err.reason).toBe("invalid-email");
      messages.push(err.message);
      transcripts.push(err.message, err.name, err.reason, err.stack ?? "", String(err), JSON.stringify({ ...err }));
    }

    for (const message of messages) expect(message.length).toBeGreaterThan(0);
    for (const text of transcripts) expect(text).not.toContain(CANARY);
  });

  test("the reason survives being logged as a plain object, because that is what a route branches on", async () => {
    // `{...err}` drops `message` -- it is a non-enumerable own property of `Error` --
    // so if `reason` were non-enumerable too, every structured log line would lose
    // the only field a caller maps onto a status code.
    const err = await refusalFor({ email: "no-at-sign" });
    const logged = { ...err };
    expect(logged.reason).toBe("invalid-email");
    expect(logged.name).toBe("InviteError");
    expect(err).toBeInstanceOf(Error);
  });

  test("a refusal carries no data beyond its name and reason, so nothing can ride out on it", async () => {
    // `normaliseEmail` has the rejected address in hand when it throws. Anything it
    // attached to the error would go to a log, a support ticket and an error
    // tracker, so the error is allowed to carry a closed vocabulary and nothing else.
    const err = await refusalFor({ email: "no-at-sign" });
    const carried = Object.entries({ ...err }).map(([field, value]) => `${field}=${String(value)}`).sort();
    expect(carried).toEqual(["name=InviteError", "reason=invalid-email"]);
  });
});