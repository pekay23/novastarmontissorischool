/**
 * `operator` -- the bootstrap and recovery path for platform operator accounts.
 *
 * Everything here is asserted against stored state in an in-memory database rather
 * than against call counts, because the properties that matter are about what a row
 * ends up containing: an argon2id hash rather than a password, the grants that were
 * asked for, `mustChangePassword` set unless the operator explicitly waived it, and a
 * lockout cleared so a locked operator can actually get back in.
 *
 * The refusals are asserted as loudly as the successes. This command is the only
 * writer of the table that guards every tenant in the fleet, so "what does it decline
 * to do" is most of its specification.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeDatabase, installFakeDatabase } from "./support/fake-prisma";
import { ArgMap } from "../commands/shared";

const fake = new FakeDatabase();
await installFakeDatabase(fake);

const { MIN_OPERATOR_PASSWORD_LENGTH, OPERATOR_PASSWORD_ENV_VAR, runOperator } = await import(
  "../commands/operator"
);

process.env.DATABASE_URL ??= "postgresql://operator:operator@localhost:5432/novastar";

const PASSWORD = "Correct-Horse-Battery-1!"

/** Everything `runOperator` writes, captured rather than printed. */
let output: string[];
let write: typeof process.stdout.write;

beforeEach(() => {
  fake.reset();
  output = [];
  write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.env[OPERATOR_PASSWORD_ENV_VAR] = PASSWORD;
});

afterEach(() => {
  process.stdout.write = write;
  delete process.env[OPERATOR_PASSWORD_ENV_VAR];
});

function args(...tokens: string[]): ArgMap {
  return ArgMap.parse([...tokens, "--yes"]);
}

function create(overrides: string[] = []): Promise<void> {
  return runOperator(
    args(
      "--username",
      "ops",
      "--email",
      "ops@example.com",
      "--capabilities",
      "platform:read,tenant:read",
      ...overrides,
    ),
  );
}

function seedOperator(overrides: Record<string, unknown> = {}, selector: Record<string, unknown> = { username: "ops" }): void {
  // Seeded under one selector, because `seed` stores a row per selector: seeding the
  // same row under both its username and its email would give the fake two operators.
  // `findUnique` can then only resolve the half the test means to exercise, which is
  // the point -- the command has to work whichever half it finds.
  fake.seed("PlatformOperator", selector, {
    id: "operator_1",
    username: "ops",
    email: "ops@example.com",
    name: "Platform Operations",
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$old$old",
    status: "ACTIVE",
    capabilities: ["platform:read"],
    mustChangePassword: false,
    loginAttempts: 5,
    lockedUntil: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  });
}

function stored(): Record<string, unknown> {
  return fake.rowsOf("PlatformOperator")[0] ?? {};
}

describe("operator create", () => {
  test("writes one active row carrying the grants it was given", async () => {
    await create();

    expect(fake.countOf("PlatformOperator")).toBe(1);
    const row = stored();
    expect(row.username).toBe("ops");
    expect(row.email).toBe("ops@example.com");
    expect(row.status).toBe("ACTIVE");
    expect(row.capabilities).toEqual(["platform:read", "tenant:read"]);
    expect(row.mustChangePassword).toBe(true);
  });

  test("stores an argon2id hash and never the password", async () => {
    await create();

    const { passwordHash } = stored() as { passwordHash: string };
    expect(passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(passwordHash).not.toContain(PASSWORD);
    // Nothing anywhere in the output either: the password goes in and does not come
    // out, on the same principle as the tenant administrator's.
    expect(output.join("")).not.toContain(PASSWORD);
  });

  test("lowercases the identifier, because sign-in folds case on both sides", async () => {
    await runOperator(
      args(
        "--username",
        "OPS",
        "--email",
        "Ops@Example.COM",
        "--capabilities",
        "platform:read",
      ),
    );

    expect(stored().username).toBe("ops");
    expect(stored().email).toBe("ops@example.com");
  });

  test("deduplicates a repeated capability", async () => {
    await runOperator(
      args("--username", "ops", "--email", "ops@example.com", "--capabilities", "tenant:read, tenant:read"),
    );

    expect(stored().capabilities).toEqual(["tenant:read"]);
  });

  test("keeps mustChangePassword false only when the operator asked for it", async () => {
    await create(["--keep-password"]);

    expect(stored().mustChangePassword).toBe(false);
    // And the command says what that costs, rather than accepting the flag silently.
    expect(output.join("")).toContain("--keep-password");
  });
});

describe("operator create refuses", () => {
  test("a password below the floor, having written nothing", async () => {
    process.env[OPERATOR_PASSWORD_ENV_VAR] = "short"

    await expect(create()).rejects.toThrow(/at least 6 characters/);
    expect(MIN_OPERATOR_PASSWORD_LENGTH).toBe(6);
    expect(fake.countOf("PlatformOperator")).toBe(0);
  })

  test("a password that meets the floor but not the composition rules", async () => {
    // Six characters, lowercase only: long enough for the floor, missing the
    // uppercase, digit and symbol the operator credential also requires.
    process.env[OPERATOR_PASSWORD_ENV_VAR] = "abcdef"

    await expect(create()).rejects.toThrow(/uppercase letter, a lowercase letter, a number and a symbol/);
    expect(MIN_OPERATOR_PASSWORD_LENGTH).toBe(6);
    expect(fake.countOf("PlatformOperator")).toBe(0);
  });

  test("a missing grant list, because a default would be an invented authorisation", async () => {
    await expect(
      runOperator(args("--username", "ops", "--email", "ops@example.com")),
    ).rejects.toThrow(/--capabilities/);
    expect(fake.countOf("PlatformOperator")).toBe(0);
  });

  test("a grant the platform's permission grammar does not recognise", async () => {
    // The grammar is not the console's vocabulary: `platform:teleport` is a
    // well-formed key that the console would silently drop at sign-in. What is
    // refused here is a key no permission could ever have.
    await expect(create(["--capabilities", "Platform:Read"])).rejects.toThrow(/permission keys/);
    await expect(create(["--capabilities", "a:b:c:d"])).rejects.toThrow(/permission keys/);
    expect(fake.countOf("PlatformOperator")).toBe(0);
  });

  test("a username another operator already holds", async () => {
    seedOperator();

    await expect(create()).rejects.toThrow(/already the operator ops/);
    expect(fake.countOf("PlatformOperator")).toBe(1);
  });

  test("an email another operator already holds", async () => {
    // The other half of the collision rule, reached by seeding under the email
    // selector so the username lookup misses.
    seedOperator({}, { email: "ops@example.com" });

    await expect(
      runOperator(
        args("--username", "someone-else", "--email", "ops@example.com", "--capabilities", "platform:read"),
      ),
    ).rejects.toThrow(/already belongs to another operator/);
  });

  test("a write without confirmation on a non-terminal", async () => {
    // `--yes` omitted. `process.stdin.isTTY` is false under the test runner, so this
    // is the unattended path: the command has to refuse rather than assume.
    await expect(
      runOperator(
        ArgMap.parse([
          "--username",
          "ops",
          "--email",
          "ops@example.com",
          "--capabilities",
          "platform:read",
        ]),
      ),
    ).rejects.toThrow(/--yes/);
    expect(fake.countOf("PlatformOperator")).toBe(0);
  });
});

describe("operator reset", () => {
  test("replaces the hash, resets the lockout, and requires a change", async () => {
    seedOperator();
    const before = stored().passwordHash as string;

    await create(["--rotate"]);

    const row = stored();
    expect(row.passwordHash).not.toBe(before);
    // A reset that left the lock in place would be a recovery path that does not
    // recover: the operator cannot sign in to clear their own counter.
    expect(row.loginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(row.mustChangePassword).toBe(true);
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
  });

  test("does not touch the grants, because a password reset is not a grant change", async () => {
    seedOperator({ capabilities: ["platform:read", "tenant:read"] });

    await create(["--rotate"]);

    expect(stored().capabilities).toEqual(["platform:read", "tenant:read"]);
  });

  test("finds the account by email alone", async () => {
    // The recovery path has to work for someone who cannot remember which identifier
    // they signed in with, so the row is reachable only by its email.
    seedOperator({}, { email: "ops@example.com" });

    await expect(
      runOperator(
        args(
          "--username",
          "ops",
          "--email",
          "ops@example.com",
          "--capabilities",
          "platform:read",
          "--rotate",
        ),
      ),
    ).resolves.toBeUndefined();
    expect(fake.callsTo("PlatformOperator", "update")).toHaveLength(1);
  });

  test("refuses when the two identifiers name different operators", async () => {
    // Better to refuse than to pick: a reset aimed at the wrong account is a
    // credential handed to the wrong person, and the operator who discovers it is the
    // one who was locked out.
    fake.seed("PlatformOperator", { username: "ops" }, {
      id: "operator_1",
      username: "ops",
      email: "ops@example.com",
      status: "ACTIVE",
      capabilities: [],
      mustChangePassword: false,
      loginAttempts: 0,
      lockedUntil: null,
    });
    fake.seed("PlatformOperator", { email: "ops@example.com" }, {
      id: "operator_2",
      username: "someone-else",
      email: "ops@example.com",
      status: "ACTIVE",
      capabilities: [],
      mustChangePassword: false,
      loginAttempts: 0,
      lockedUntil: null,
    });

    await expect(create(["--rotate"])).rejects.toThrow(/different operators/);
    expect(fake.callsTo("PlatformOperator", "update")).toHaveLength(0);
  });

  test("refuses an account nobody holds, and says to drop --rotate", async () => {
    await expect(create(["--rotate"])).rejects.toThrow(/Drop --rotate/);
    expect(fake.callsTo("PlatformOperator", "create")).toHaveLength(0);
    expect(fake.callsTo("PlatformOperator", "update")).toHaveLength(0);
  });
});