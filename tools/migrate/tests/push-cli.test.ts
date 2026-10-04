/**
 * `push`, end to end, through the CLI rather than the exported guard.
 *
 * `guards.test.ts` pins the decision. This file pins the parts around it that
 * a unit test cannot reach, because `index.ts` ends in `process.exit(await
 * main())` and so cannot be imported at all: that `push` is a command the
 * parser knows, that its allowlist is what the parser enforces, and — the one
 * that matters — that there is no flag combination which talks past the host
 * check.
 *
 * Every case here refuses before Prisma is spawned, so none of them needs a
 * database or a network, and `MIGRATE_SKIP_DOTENV=1` keeps the repo root `.env`
 * out of it. A case that ever reached Prisma would fail on the connection
 * rather than on the assertion, which is the point: the assertion is that it
 * never gets that far.
 */
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const toolDir = resolve(here, "..");
const entry = resolve(toolDir, "index.ts");

/** A host that is emphatically not a developer's machine. */
const REMOTE = "postgresql://u:p@ep-frosty-pond.us-east-2.aws.neon.tech:5432/neondb";

interface CliResult {
  readonly code: number;
  readonly output: string;
}

async function runCli(args: readonly string[], env: Record<string, string> = {}): Promise<CliResult> {
  const proc = Bun.spawn([process.execPath, entry, ...args], {
    cwd: toolDir,
    // Nothing inherited: the developer's own DATABASE_URL has no business
    // deciding what this test refuses.
    env: { ...env, MIGRATE_SKIP_DOTENV: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, output: `${stdout}${stderr}` };
}

describe("push is wired into the CLI", () => {
  test("is listed in the usage text", async () => {
    const { code, output } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(output).toContain("push");
    expect(output).toContain("LOCAL databases only");
  });

  test("refuses a remote target, and Prisma is never reached", async () => {
    const { code, output } = await runCli(["push"], { DATABASE_URL: REMOTE });
    expect(code).toBe(1);
    expect(output).toContain("not a local address");
    expect(output).toContain("db:migrate:deploy");
    // The mechanism line is printed before the guard runs, so its absence is
    // how "it got as far as Prisma" would show up.
    expect(output).not.toContain("Your database is now in sync");
  });

  test("refuses a remote target reached through --target direct", async () => {
    const { code, output } = await runCli(["push", "--target", "direct"], {
      DATABASE_URL: "postgresql://u:p@localhost:5432/app",
      DIRECT_URL: REMOTE,
    });
    expect(code).toBe(1);
    expect(output).toContain("not a local address");
    // The guard must have judged the host it was handed, not DATABASE_URL.
    expect(output).toContain("ep-frosty-pond.us-east-2.aws.neon.tech");
  });

  test("refuses a remote mirror", async () => {
    const { code, output } = await runCli(["push", "--target", "mirror"], {
      SUPABASE_DATABASE_URL: "postgresql://u:p@db.project.supabase.co:5432/postgres",
    });
    expect(code).toBe(1);
    expect(output).toContain("not a local address");
  });

  /**
   * The property the whole command exists for. `deploy` and `baseline` can be
   * pushed through with `--allow-production` or `--yes`; `push` accepts
   * neither, so the acknowledgement flags are a usage error rather than a
   * silently ignored extra.
   */
  test.each([["--allow-production"], ["--prod"], ["--dev"], ["--dev-only"]])(
    "%s is a usage error, not a way past the host check",
    async (flag) => {
      const { code, output } = await runCli(["push", flag], { DATABASE_URL: REMOTE });
      expect(code).toBe(2);
      expect(output).toContain(`unknown flag ${flag} for "push"`);
    },
  );

  /**
   * `--yes` is global, so it parses. It still buys nothing here: the refusal is
   * a host check, not a confirmation, and asserting that is the difference
   * between "the flag is unknown" and "the flag does not help".
   */
  test("--yes is accepted by the parser and changes nothing", async () => {
    const { code, output } = await runCli(["push", "--yes"], { DATABASE_URL: REMOTE });
    expect(code).toBe(1);
    expect(output).toContain("not a local address");
  });

  test("a missing connection string is named rather than guessed at", async () => {
    const { code, output } = await runCli(["push"]);
    expect(code).toBe(1);
    expect(output).toContain("DATABASE_URL");
  });

  test("--target without a value is a usage error", async () => {
    const { code, output } = await runCli(["push", "--target"]);
    expect(code).toBe(2);
    expect(output).toContain("--target needs a value");
  });
});