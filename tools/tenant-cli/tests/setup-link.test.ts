/**
 * `setup-link` -- the one command in this tool whose product is a credential.
 *
 * Almost everything asserted here is a refusal, which is the point. The command
 * mints a live single-use token and prints it; the properties that keep that
 * acceptable are that only an account with no password can be targeted, only an
 * acknowledged host is contacted, the plaintext never reaches disk, and no error
 * path carries it.
 *
 * The load-bearing assertion is `stored.verifyToken` being the SHA-256 digest and
 * never the plaintext. If that were ever false, this command would have quietly
 * become a credential store rather than a delivery workaround, and every other
 * property here would be damage control.
 *
 * The database is an in-memory fake, so nothing in this file contacts Neon.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeDatabase, installFakeDatabase } from "./support/fake-prisma";
import { ArgMap } from "../commands/shared";

const fake = new FakeDatabase();
await installFakeDatabase(fake);

// Called before anything reads the environment, and deliberately: `loadEnv()`
// memoises, so every later `process.env.DATABASE_URL` written by these tests is
// the value the command actually reads. Without this the repository `.env` would
// decide the host mid-suite and the remote-host cases would be untestable.
const { loadEnv } = await import("../config");
loadEnv();

const {
  EMAIL_TOKEN_TTL_HOURS,
  hashEmailToken,
  isEmailToken,
} = await import("@novastar/auth/invite");
const {
  SETUP_LINK_HELP,
  TOKEN_PLACEHOLDER,
  assertRemoteDatabaseAllowed,
  redactSetupToken,
  runSetupLink,
} = await import("../commands/setup-link");

const ORIGIN = "https://portal.novastar.test";
const LOCAL_URL = "postgresql://dev:dev@localhost:5432/novastar";
const REMOTE_URL = "postgresql://user:secret@ep-tiny-firefly-b5ee7bwm.aws.neon.tech/neondb?sslmode=require";

const TENANT_CODE = "novastar";
const TENANT_ID = "tenant_1";
const EMAIL = "head@novastar.test";

/** Everything `runSetupLink` prints, captured rather than shown. */
let output: string[];
let errors: string[];
let write: typeof process.stdout.write;
let writeError: typeof process.stderr.write;
let originalDatabaseUrl: string | undefined;
let originalNextAuthUrl: string | undefined;
let originalPublicOrigin: string | undefined;

beforeEach(() => {
  originalDatabaseUrl = process.env.DATABASE_URL;
  originalNextAuthUrl = process.env.NEXTAUTH_URL;
  originalPublicOrigin = process.env.NEXT_PUBLIC_ORIGIN;
  fake.reset();
  output = [];
  errors = [];
  write = process.stdout.write.bind(process.stdout);
  writeError = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    output.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    errors.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  process.env.DATABASE_URL = LOCAL_URL;
  process.env.NEXTAUTH_URL = ORIGIN;
  delete process.env.NEXT_PUBLIC_ORIGIN;

  seedTenant();
});

afterEach(() => {
  process.stdout.write = write;
  process.stderr.write = writeError;
  // Restored rather than left in place: `bun test` runs every file in one
  // process, so a `DATABASE_URL` or an origin pointing at this file's fixture
  // would follow the suite into whichever file runs next.
  process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalNextAuthUrl;
  if (originalPublicOrigin === undefined) delete process.env.NEXT_PUBLIC_ORIGIN;
  else process.env.NEXT_PUBLIC_ORIGIN = originalPublicOrigin;
});

function seedTenant(): void {
  fake.seed("Tenant", { code: TENANT_CODE }, { id: TENANT_ID, code: TENANT_CODE, name: "Novastar" });
}

/** An invited account: created, active, and holding no password. */
function seedInvitedUser(overrides: Record<string, unknown> = {}): void {
  fake.seed("User", { tenantId_email: { tenantId: TENANT_ID, email: EMAIL } }, {
    id: "user_1",
    tenantId: TENANT_ID,
    email: EMAIL,
    isActive: true,
    status: "ACTIVE",
    passwordHash: null,
    verifyToken: null,
    verifyTokenExpires: null,
    ...overrides,
  });
}

function args(...tokens: string[]): ArgMap {
  return ArgMap.parse([...tokens, "--yes"]);
}

function mint(...tokens: string[]): Promise<void> {
  return runSetupLink(args("--tenant", TENANT_CODE, "--email", EMAIL, ...tokens));
}

function storedUser(): Record<string, unknown> {
  return fake.rowsOf("User")[0] ?? {};
}

function printed(): string {
  return output.join("");
}

function printedUrl(): string {
  const url = printed().match(/https?:\/\/\S+\?token=\S+/);
  if (!url) throw new Error(`no setup URL in output:\n${printed()}`);
  return url[0];
}

function printedToken(): string {
  return new URL(printedUrl()).searchParams.get("token") ?? "";
}

/**
 * Every string held anywhere in the fake database, so "the plaintext is not
 * recoverable" is asserted against the whole store rather than against the one
 * column it would have to be hiding in.
 */
function storedStrings(): string[] {
  const found: string[] = [];
  for (const rows of fake.stores.values()) {
    for (const row of rows.values()) {
      const walk = (value: unknown): void => {
        if (typeof value === "string") found.push(value);
        else if (value instanceof Date) found.push(value.toISOString());
        else if (typeof value === "object" && value !== null) {
          for (const item of Object.values(value as Record<string, unknown>)) walk(item);
        }
      };
      walk(row);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// succeeds
// ---------------------------------------------------------------------------

describe("setup-link mints a link", () => {
  test("prints an absolute URL on the /set-password path with the token in the query", async () => {
    seedInvitedUser();

    await mint();

    const parsed = new URL(printedUrl());
    expect(parsed.pathname).toBe("/set-password");
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.searchParams.has("token")).toBe(true);
    // The shape `authorize()` and `isEmailToken` expect, so the link really is
    // the journey's link and not a string that merely looks like one.
    expect(isEmailToken(parsed.searchParams.get("token") ?? "")).toBe(true);
  });

  test("says out loud that it is a single-use credential, when it expires, and what it sets", async () => {
    seedInvitedUser();

    await mint();

    const text = printed();
    expect(text).toContain("single-use credential");
    expect(text).toContain("choose the password");
    expect(text).toContain(EMAIL);
    expect(text).toContain("RESEND_API_KEY");
    // The real deadline, from the constant the emailed link is built with, not a
    // hardcoded "24" that could drift away from it.
    expect(text).toContain(`${EMAIL_TOKEN_TTL_HOURS} hours`);
    const deadline = storedUser().verifyTokenExpires as Date;
    expect(text).toContain(deadline.toISOString());
  });

  test("stores a digest, never the plaintext, so the link is not recoverable afterwards", async () => {
    seedInvitedUser();

    await mint();

    const token = printedToken();
    const row = storedUser();
    expect(row.verifyToken).toBe(hashEmailToken(token));
    expect(row.verifyToken).not.toBe(token);
    // A SHA-256 digest is 64 hex characters. Asserting the shape catches a change
    // from "hash the token" to "store it", which a value-equality check against a
    // known token would also catch but only if the token were readable.
    expect(String(row.verifyToken)).toMatch(/^[0-9a-f]{64}$/);
    expect(row.verifyTokenExpires).toBeInstanceOf(Date);
    expect(Number(row.verifyTokenExpires)).toBeGreaterThan(Date.now());

    // And nothing anywhere in the store carries it.
    for (const value of storedStrings()) {
      expect(value).not.toContain(token);
    }
  });

  test("writes exactly one row and no file", async () => {
    seedInvitedUser();

    await mint();

    expect(fake.callsTo("User", "update")).toHaveLength(1);
    expect(fake.callsTo("User", "create")).toHaveLength(0);
    expect(fake.callsTo("User", "delete")).toHaveLength(0);
    const written = fake.callsTo("User", "update")[0].args.data as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(["verifyToken", "verifyTokenExpires"]);
  });

  test("finds the account case-insensitively, because the row is stored folded", async () => {
    fake.seed("User", { tenantId_email: { tenantId: TENANT_ID, email: EMAIL } }, {
      id: "user_1",
      tenantId: TENANT_ID,
      email: EMAIL,
      isActive: true,
      passwordHash: null,
    });

    await runSetupLink(args("--tenant", TENANT_CODE, "--email", "HEAD@Novastar.TEST", "--yes"));

    expect(printedUrl()).toContain("?token=vem_");
  });

  test("warns rather than refusing when the account is inactive", async () => {
    // The link works and the account still cannot sign in, so refusing here would
    // be wrong; saying nothing would produce a support call.
    seedInvitedUser({ isActive: false });

    await mint();

    expect(printed()).toContain("inactive");
    expect(fake.callsTo("User", "update")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// refuses
// ---------------------------------------------------------------------------

describe("setup-link refuses", () => {
  test("an account that already has a password, writing nothing", async () => {
    // The 409 already-has-password mirror. Without this the command is a password
    // reset for anyone who can run the CLI.
    seedInvitedUser({ passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def" });

    await expect(mint()).rejects.toThrow(/already has a password/);
    expect(fake.callsTo("User", "update")).toHaveLength(0);
  });

  test("a non-local host without the acknowledgement flag, without contacting it", async () => {
    seedInvitedUser();
    process.env.DATABASE_URL = REMOTE_URL;
    fake.resetCalls();

    await expect(mint()).rejects.toThrow(/--allow-remote-database/);
    // Not one statement: the gate runs before the first read, so an
    // unacknowledged host is never contacted at all.
    expect(fake.calls).toHaveLength(0);
  });

  test("the same non-local host once the flag is passed", async () => {
    seedInvitedUser();
    process.env.DATABASE_URL = REMOTE_URL;

    await expect(mint("--allow-remote-database")).resolves.toBeUndefined();

    expect(fake.callsTo("User", "update")).toHaveLength(1);
    expect(printed()).toContain(TENANT_CODE);
    // Nothing about the connection string, and in particular not its password.
    // `redactDatabase` exists for this elsewhere; a gate that names a host must not
    // become the thing that prints the host's credentials.
    expect(printed()).not.toContain("secret");
    expect(printed()).not.toContain(REMOTE_URL);
    expect(errors.join("")).not.toContain("secret");
  });

  test("a local host without the flag, because there is nothing to acknowledge", async () => {
    seedInvitedUser();

    await expect(mint()).resolves.toBeUndefined();
  });

  test("an email no account on that tenant holds", async () => {
    await expect(mint()).rejects.toThrow(/No account for/);
    expect(fake.callsTo("User", "update")).toHaveLength(0);
  });

  test("an email that exists in another tenant", async () => {
    // Scoping is the reason the lookup is not "find by email": the same address
    // can exist twice, and a link for the wrong school's account is a credential
    // handed to the wrong person.
    fake.seed("Tenant", { code: "another" }, { id: "tenant_2", code: "another" });
    fake.seed("User", { tenantId_email: { tenantId: "tenant_2", email: EMAIL } }, {
      id: "user_2",
      tenantId: "tenant_2",
      email: EMAIL,
      passwordHash: null,
    });

    await expect(mint()).rejects.toThrow(/No account for/);
    expect(fake.callsTo("User", "update")).toHaveLength(0);
  });

  test("a tenant code nobody holds", async () => {
    seedInvitedUser();

    await expect(runSetupLink(args("--tenant", "nope", "--email", EMAIL, "--yes"))).rejects.toThrow(
      /No tenant with code/,
    );
    expect(fake.callsTo("User", "update")).toHaveLength(0);
  });

  test("a token passed on the command line, which would be in shell history", async () => {
    seedInvitedUser();

    await expect(mint("--token", "vem_something")).rejects.toThrow(/will not accept one/);
    expect(fake.callsTo("User", "update")).toHaveLength(0);
  });

  test("a positional argument, without echoing what it was", async () => {
    // The value is not named back: a pasted link carries the token, and a usage
    // error that quotes it is a usage error that leaks it.
    const pasted = `${ORIGIN}/set-password?token=vem_pasted`;
    await expect(
      runSetupLink(ArgMap.parse(["--tenant", TENANT_CODE, "--email", EMAIL, pasted, "--yes"])),
    ).rejects.toThrow(/may be a setup link/);
    expect(errors.join("")).not.toContain("vem_pasted");
    expect(printed()).not.toContain("vem_pasted");
  });

  test("a write without confirmation on a non-terminal", async () => {
    seedInvitedUser();

    await expect(
      runSetupLink(ArgMap.parse(["--tenant", TENANT_CODE, "--email", EMAIL])),
    ).rejects.toThrow(/--yes/);
    expect(fake.callsTo("User", "update")).toHaveLength(0);
  });

  test("a missing portal origin, before anything is written", async () => {
    // Resolving the origin after the mint would leave a digest on the row that
    // nothing can be delivered for.
    seedInvitedUser();
    delete process.env.NEXTAUTH_URL;
    delete process.env.NEXT_PUBLIC_ORIGIN;

    await expect(mint()).rejects.toThrow(/NEXTAUTH_URL/);
    expect(fake.callsTo("User", "update")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// the token never leaks
// ---------------------------------------------------------------------------

describe("setup-link never leaks the token", () => {
  test("no refusal path carries a token in its message or on either stream", async () => {
    // Every refusal in turn, with the ones that need a row arranged first. None of
    // them mints, so the property under test is that nothing about a *previous*
    // run's token can reach a message -- which is the real shape of the risk, since
    // an operator who has just seen a link is exactly who will hit an error next.
    const failure = async (work: () => Promise<void>): Promise<string> => {
      const message = await work().then(
        () => "",
        (error: Error) => error.message,
      );
      return message;
    };

    seedInvitedUser({ passwordHash: "$argon2id$v=19$m=1$abc$def" });
    const alreadyHasPassword = await failure(() => mint());
    process.env.DATABASE_URL = REMOTE_URL;
    const remote = await failure(() => mint());
    process.env.DATABASE_URL = LOCAL_URL;
    const noToken = await failure(() => mint("--token", "vem_supplied"));
    const pasted = await failure(() =>
      runSetupLink(
        ArgMap.parse(["--tenant", TENANT_CODE, "--email", EMAIL, `${ORIGIN}/set-password?token=vem_pasted`, "--yes"]),
      ),
    );

    const transcripts = [alreadyHasPassword, remote, noToken, pasted, printed(), errors.join("")];
    for (const text of transcripts) {
      // The token prefix must not appear anywhere. Any `vem_` at all would be a
      // mintable-shaped string in a message or a log, which is the actual hazard --
      // it does not have to be the token from this run.
      expect(text).not.toContain("vem_");
    }
    // Each refusal actually refused: a message that was empty would make the scan
    // above pass for the wrong reason.
    for (const message of [alreadyHasPassword, remote, noToken, pasted]) {
      expect(message.length).toBeGreaterThan(0);
    }
    // And none of them printed or wrote anything at all -- every refusal happens
    // before the first line of output.
    expect(printed()).toBe("");
    expect(errors.join("")).toBe("");
  });

  test("a failure after the token is minted is rebuilt without it", async () => {
    seedInvitedUser();

    // A stream that rejects, and -- the point -- rejects with an error that quotes
    // the very bytes it was handed. That is the worst case a print failure can
    // have, and it is the only path that could carry a minted link out of this
    // process. The stub fires on the write that carries the link, not the first
    // one, so the redaction is what is actually under test.
    let handed = "";
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      const text = String(chunk);
      if (text.includes("?token=")) {
        handed = text;
        throw new Error(`EPIPE after writing ${text}`);
      }
      output.push(text);
      return true;
    }) as typeof process.stdout.write;

    const failure = await mint().then(
      () => null,
      (error: Error) => error,
    );

    // The real token, read out of the chunk the failing stream received.
    const token = new URL(handed.match(/https?:\/\/\S+\?token=\S+/)?.[0] ?? "https://x/?token=").searchParams.get("token") ?? "";
    expect(token).not.toBe("");

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain(TOKEN_PLACEHOLDER);
    expect(failure?.message).not.toContain(token);
    // The origin is not a credential and is left readable, so the message is still
    // diagnosable rather than a wall of redactions.
    expect(failure?.message).toContain("re-run");
  });

  test("redactSetupToken replaces the token and leaves everything else alone", () => {
    expect(redactSetupToken("a vem_abc b vem_abc", "vem_abc")).toBe("a [setup token redacted] b [setup token redacted]");
    // An empty token would otherwise make `split("")` splice between every
    // character.
    expect(redactSetupToken("unchanged", "")).toBe("unchanged");
  });
});

// ---------------------------------------------------------------------------
// the pure guard and the documentation
// ---------------------------------------------------------------------------

describe("assertRemoteDatabaseAllowed", () => {
  test("opens for the addresses tools/migrate treats as this machine", () => {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "0.0.0.0", "app.localhost"]) {
      expect(() => assertRemoteDatabaseAllowed(host, false)).not.toThrow();
    }
  });

  test("refuses everything else, and names the flag", () => {
    for (const host of ["ep-x.aws.neon.tech", "db.example.com", "postgres.internal", "localhost.evil.test"]) {
      expect(() => assertRemoteDatabaseAllowed(host, false)).toThrow(/--allow-remote-database/);
      expect(() => assertRemoteDatabaseAllowed(host, true)).not.toThrow();
    }
  });

  test("does not quote the URL it refused", () => {
    expect(() => assertRemoteDatabaseAllowed("db.example.com", false)).toThrow(/^Refusing to mint a setup link against db\.example\.com/);
  });
});

describe("SETUP_LINK_HELP", () => {
  test("names RESEND_API_KEY as the real fix, so the command reads as a development aid", () => {
    expect(SETUP_LINK_HELP).toContain("RESEND_API_KEY");
    expect(SETUP_LINK_HELP).toContain("DEVELOPMENT AID");
  });

  test("documents the acknowledgement flag and --yes, and offers no --token", () => {
    expect(SETUP_LINK_HELP).toContain("--allow-remote-database");
    expect(SETUP_LINK_HELP).toContain("--yes");
    expect(SETUP_LINK_HELP).not.toMatch(/^\s*--token/m);
  });
});