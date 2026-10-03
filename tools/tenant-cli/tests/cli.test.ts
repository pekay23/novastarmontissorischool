/**
 * CLI surface: usage text, argument parsing, and the library-import guarantee.
 *
 * The `--help` cases run the real entry point in a subprocess with
 * `DATABASE_URL` removed, because that is the only way to prove the requirement
 * rather than assert it: no environment, no database, no arguments, exit 0.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ArgMap } from "../commands/shared";

const packageRoot = join(import.meta.dir, "..");
const entryPoint = join(packageRoot, "index.ts");

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const child = Bun.spawn([process.execPath, entryPoint, ...args], {
    cwd: packageRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

describe("--help with no database", () => {
  test("exits 0 and prints usage with no arguments at all", async () => {
    const result = await run([], { DATABASE_URL: "" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("novastar-tenant");
    expect(result.stdout).toContain("Commands:");
  });

  test("exits 0 with --help and no DATABASE_URL", async () => {
    const result = await run(["--help"], { DATABASE_URL: "" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("novastar-tenant <command> [options]");
  });

  test("exits 0 with -h", async () => {
    const result = await run(["-h"], { DATABASE_URL: "" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Commands:");
  });

  test("exits 0 for `help`", async () => {
    const result = await run(["help"], { DATABASE_URL: "" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Commands:");
  });

  test("never mentions the connection string or a secret", async () => {
    const result = await run(["--help"], { DATABASE_URL: "" });
    expect(result.stdout).not.toContain("postgresql://");
    expect(result.stderr).not.toContain("DATABASE_URL is not set");
    expect(result.stderr).toBe("");
  });

  test("lists every command", async () => {
    const { stdout } = await run(["--help"], { DATABASE_URL: "" });
    for (const command of [
      "create",
      "clone",
      "list",
      "show",
      "set",
      "config get",
      "config set",
      "config export",
      "import",
      "suspend",
      "reactivate",
      "user",
    ]) {
      expect(stdout).toContain(command);
    }
  });

  test("a subcommand's own --help also works without a database", async () => {
    const result = await run(["clone", "--help"], { DATABASE_URL: "" });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--from <code>");
  });
});

describe("dispatch errors", () => {
  test("an unknown command exits 2 and still prints usage", async () => {
    const result = await run(["not-a-command"], { DATABASE_URL: "" });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("Commands:");
  });
});

describe("ArgMap", () => {
  test("parses positionals and both flag spellings", () => {
    const args = ArgMap.parse(["positional", "--code", "another", "--domain=school.example.com", "--apply"]);
    expect(args.positionals).toEqual(["positional"]);
    expect(args.get("code")).toBe("another");
    expect(args.get("domain")).toBe("school.example.com");
    expect(args.flag("apply")).toBe(true);
  });

  test("a valueless flag followed by another flag stays boolean", () => {
    const args = ArgMap.parse(["--apply", "--school", "main"]);
    expect(args.boolean("apply")).toBe(true);
    expect(args.get("school")).toBe("main");
  });

  test("a leading-dash value is still consumed as a value", () => {
    const args = ArgMap.parse(["--value", "-5"]);
    expect(args.get("value")).toBe("-5");
  });

  test("`--` ends flag parsing", () => {
    const args = ArgMap.parse(["--", "--not-a-flag"]);
    expect(args.positionals).toEqual(["--not-a-flag"]);
  });

  test("require names the flag it is missing", () => {
    expect(() => ArgMap.parse([]).require("code")).toThrow(/--code/);
  });

  test("boolean accepts the usual spellings and rejects the rest", () => {
    expect(ArgMap.parse(["--yes"]).boolean("yes")).toBe(true);
    expect(ArgMap.parse(["--yes", "true"]).boolean("yes")).toBe(true);
    expect(ArgMap.parse(["--yes", "0"]).boolean("yes")).toBe(false);
    expect(ArgMap.parse([]).boolean("yes")).toBe(false);
    expect(() => ArgMap.parse(["--yes", "maybe"]).boolean("yes")).toThrow(/boolean/);
  });
});

describe("library-import guarantee", () => {
  const source = readFileSync(join(packageRoot, "provision.ts"), "utf8");

  test("provision.ts reads no argv", () => {
    expect(source).not.toContain("process.argv");
  });

  test("provision.ts prints nothing", () => {
    expect(source).not.toContain("console.");
    expect(source).not.toContain("process.");
  });

  test("provision.ts exits nothing", () => {
    expect(source).not.toContain("process.exit");
    expect(source).not.toContain("Bun.exit");
  });

  test("provision.ts exports the shared entry point", () => {
    expect(source).toContain("export async function provisionTenant");
  });
});