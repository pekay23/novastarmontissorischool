/**
 * The one place this tool talks to Prisma.
 *
 * Prisma owns applying SQL migrations. It lives in `packages/database`, and it
 * is invoked as a subprocess rather than imported, so there is exactly one
 * Prisma in the tree and no chance of the tool and the package that owns the
 * migrations disagreeing about versions.
 *
 * Two details that are not optional:
 *
 * - **`--no-install`.** `bun x` will otherwise resolve `prisma` from a global
 *   cache if `packages/database` has no local copy, and a migration would then
 *   run under a version the repo never pinned. Failing is correct; silently
 *   picking up another version is not.
 *
 * - **Resolve on `exit`, never on `close`, and always with a timeout.** Prisma
 *   keeps its query-compiler and schema-engine children alive past its own
 *   exit, and those children inherit the stdio pipes. Waiting for `close` waits
 *   for the grandchildren, which is how a status check becomes a stuck CI
 *   pipeline. There is also a hard kill so a wedged DDL cannot hang forever.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { databasePackageDir, mustExist, repoRoot } from "./env";

export interface PrismaResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Both streams, for error messages where the split does not matter. */
  readonly output: string;
}

export interface RunPrismaOptions {
  /** Extra environment for the child. Merged over this process's. */
  readonly env?: NodeJS.ProcessEnv;
  /** Pipe the parent's stdio straight through instead of capturing. */
  readonly inherit?: boolean;
  /** Text written to the child's stdin, then closed. Never a TTY prompt. */
  readonly input?: string;
  /** Hard kill after this many ms. Every Prisma call is bounded. */
  readonly timeoutMs?: number;
}

/** 5 minutes. Generous for a big DDL, short enough that CI cannot wedge. */
export const DEFAULT_TIMEOUT_MS = 300_000;

export const schemaPath = (): string =>
  mustExist(
    resolve(databasePackageDir(), "prisma/schema.prisma"),
    "Prisma schema",
  );

export const migrationsDir = (): string =>
  mustExist(
    resolve(databasePackageDir(), "prisma/migrations"),
    "Prisma migrations directory",
  );

/**
 * The Prisma version that will actually run, read from the manifest rather
 * than `prisma --version`: that command leaves the engine children holding
 * stdio open, and the answer is a field in a file.
 */
export function prismaVersion(): string {
  try {
    const manifest = resolve(
      databasePackageDir(),
      "node_modules/prisma/package.json",
    );
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf-8"));
    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "not installed";
  }
}

/**
 * `bun` itself. Under `bun run` this is the interpreter already running us, so
 * no PATH lookup and no `.cmd` shim to fight on Windows.
 */
function bunExecutable(): string {
  return process.execPath;
}

/**
 * Runs a Prisma CLI subcommand from `packages/database`, which is what makes
 * `prisma.config.ts`, the schema and the migrations directory all resolve.
 */
export function runPrisma(
  args: readonly string[],
  options: RunPrismaOptions = {},
): Promise<PrismaResult> {
  const cwd = databasePackageDir();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<PrismaResult>((resolvePromise, reject) => {
    const child = spawn(bunExecutable(), ["x", "--no-install", "prisma", ...args], {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: options.inherit ? ["ignore", "inherit", "inherit"] : "pipe",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    } else if (!options.inherit) {
      // Closed, never held open. An unanswered prompt must fail fast rather
      // than wait for input that CI will never supply.
      child.stdin?.end();
    }

    child.on("error", (err) => settle(() => reject(err)));
    // `exit`, not `close`: see the file header.
    child.on("exit", (code) =>
      settle(() =>
        resolvePromise({
          code: timedOut ? 124 : (code ?? 1),
          stdout,
          stderr,
          output: [stdout, stderr].filter(Boolean).join("\n"),
        }),
      ),
    );
  });
}

/** Runs a Prisma subcommand and throws with its own output when it fails. */
export async function runPrismaOrThrow(
  args: readonly string[],
  options: RunPrismaOptions = {},
): Promise<PrismaResult> {
  const result = await runPrisma(args, options);
  if (result.code !== 0) {
    throw new Error(
      `prisma ${args.join(" ")} exited ${result.code}\n${result.output.trim()}`,
    );
  }
  return result;
}

/** A filesystem `git` read, used only by the clean-tree guard. Never mutating. */
export function git(args: readonly string[]): Promise<PrismaResult> {
  return new Promise<PrismaResult>((resolvePromise, reject) => {
    const child = spawn("git", [...args], {
      cwd: repoRoot(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
        output: [stdout, stderr].filter(Boolean).join("\n"),
      }),
    );
  });
}
