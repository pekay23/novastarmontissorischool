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

/**
 * Per-test budget for anything that spawns the real CLI.
 *
 * Bun's default is 5000ms. That default is sized for an in-process assertion, and
 * these tests do nothing else: each one starts a fresh `bun`, transpiles and
 * resolves the CLI's module graph, drains both pipes and waits for the exit code.
 * Measured single-spawn wall time for `bun index.ts --help` on this repo (Windows,
 * 4 logical CPUs) was 0.24-0.44s warm, 1.1s with an empty transpiler cache, and
 * 5.7s on the first invocation after the OS page cache had been dropped. Under 8x
 * CPU oversubscription -- which is what `turbo run test` does to this file while
 * eight other workspaces are testing -- the same command took 0.9-4.8s.
 *
 * 5000ms therefore sat *inside* that distribution rather than above it, and these
 * tests failed with `this test timed out after 5000ms` plus
 * `expect(received).toBe(expected) / Expected: 0 / Received: 143`. The 143 is not
 * a separate defect and not a signal about the CLI: 143 is 128 + SIGTERM, and at
 * the timeout Bun kills the child it spawned ("killed 1 dangling process"), so a
 * SIGTERM'd child reports 143. No assertion was ever reached.
 *
 * 30s is roughly 5x the worst observation above. It bounds process-start cost and
 * nothing else: a real deadlock still fails here, just five seconds later than it
 * otherwise would. Raising this number is not what fixed the flakiness -- moving
 * the `@novastar/database` import in `provision.ts` off module load did that, by
 * cutting the cold spawn from 3.1s to 1.1s -- this is the margin that stops an
 * unlucky page-cache miss from reading as a broken CLI.
 */
const SPAWN_TIMEOUT_MS = 30_000;

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
  }, SPAWN_TIMEOUT_MS);

  test("refuses a remote target, and Prisma is never reached", async () => {
    const { code, output } = await runCli(["push"], { DATABASE_URL: REMOTE });
    expect(code).toBe(1);
    expect(output).toContain("not a local address");
    expect(output).toContain("db:migrate:deploy");
    // The mechanism line is printed before the guard runs, so its absence is
    // how "it got as far as Prisma" would show up.
    expect(output).not.toContain("Your database is now in sync");
  }, SPAWN_TIMEOUT_MS);

  test("refuses a remote target reached through --target direct", async () => {
    const { code, output } = await runCli(["push", "--target", "direct"], {
      DATABASE_URL: "postgresql://u:p@localhost:5432/app",
      DIRECT_URL: REMOTE,
    });
    expect(code).toBe(1);
    expect(output).toContain("not a local address");
    // The guard must have judged the host it was handed, not DATABASE_URL.
    expect(output).toContain("ep-frosty-pond.us-east-2.aws.neon.tech");
  }, SPAWN_TIMEOUT_MS);

  test("refuses a remote mirror", async () => {
    const { code, output } = await runCli(["push", "--target", "mirror"], {
      SUPABASE_DATABASE_URL: "postgresql://u:p@db.project.supabase.co:5432/postgres",
    });
    expect(code).toBe(1);
    expect(output).toContain("not a local address");
  }, SPAWN_TIMEOUT_MS);

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
    SPAWN_TIMEOUT_MS,
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
  }, SPAWN_TIMEOUT_MS);

  test("a missing connection string is named rather than guessed at", async () => {
    const { code, output } = await runCli(["push"]);
    expect(code).toBe(1);
    expect(output).toContain("DATABASE_URL");
  }, SPAWN_TIMEOUT_MS);

  test("--target without a value is a usage error", async () => {
    const { code, output } = await runCli(["push", "--target"]);
    expect(code).toBe(2);
    expect(output).toContain("--target needs a value");
  }, SPAWN_TIMEOUT_MS);
});