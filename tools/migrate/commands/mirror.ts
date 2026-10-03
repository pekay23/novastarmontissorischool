/**
 * `mirror` — delegate to `@novastar/db-mirror`.
 *
 * One command should answer "is the primary schema applied *and* is the
 * failsafe current", and that is `status` followed by this. Both databases, one
 * answer.
 *
 * `tools/db-mirror/mirror.ts` is a **script**: importing it would run a mirror
 * as a side effect of resolving an import. So this delegates by spawning it
 * rather than by importing it, and resolves it by package name first
 * (`@novastar/db-mirror`, resolved through the workspace link) with the repo
 * path as the fallback. Either way the exit code is passed through, so a
 * failed mirror is a failed `mirror`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "../env";
import { heading, line, success, type Context } from "../log";

export const MIRROR_MECHANISM = "@novastar/db-mirror (tools/db-mirror/mirror.ts)";

export interface MirrorOptions {
  /** `--verify-only`: compare without writing. */
  readonly verifyOnly: boolean;
  /** Extra arguments passed straight through. */
  readonly passthrough: readonly string[];
}

/**
 * The mirror entry point. Prefers the workspace link so the tool follows the
 * package rather than a path, and falls back to the repo layout for the case
 * where `bun install` has not linked the workspace yet.
 */
export function resolveMirrorEntry(): { path: string; via: string } {
  try {
    const linked = Bun.resolveSync("@novastar/db-mirror", repoRoot());
    if (existsSync(linked)) return { path: linked, via: "@novastar/db-mirror" };
  } catch {
    // Not linked yet. The repo layout is the same file.
  }
  const fallback = resolve(repoRoot(), "tools/db-mirror/mirror.ts");
  if (!existsSync(fallback)) {
    throw new Error(
      `the mirror entry point is not resolvable: @novastar/db-mirror is not ` +
        `linked and ${fallback} does not exist`,
    );
  }
  return { path: fallback, via: "tools/db-mirror/mirror.ts" };
}

export function runMirrorProcess(
  entry: string,
  args: readonly string[],
): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    // `process.execPath` is bun, so no PATH lookup and no .cmd shim on Windows.
    const child = spawn(process.execPath, ["run", entry, ...args], {
      cwd: repoRoot(),
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

export async function runMirror(ctx: Context, options: MirrorOptions): Promise<void> {
  const entry = resolveMirrorEntry();
  const args = [...options.verifyOnly ? ["--verify-only"] : [], ...options.passthrough];

  heading(`delegating to ${entry.via}`);
  line(`  entry: ${entry.path}`);
  line(`  args:  ${args.length > 0 ? args.join(" ") : "(none)"}`);
  if (!options.verifyOnly) {
    line("  The failsafe is truncated and repopulated. The primary is read-only.");
  }

  const code = await runMirrorProcess(entry.path, args);
  if (code !== 0) {
    throw new Error(`${entry.via} exited ${code}`);
  }
  success(ctx, options.verifyOnly ? "mirror is current" : "mirror refreshed");
}
