/**
 * Refuses to run against a schema that is not committed.
 *
 * Baselining writes a ledger row that claims a migration was applied. If the
 * datamodel that migration came from is only in someone's working tree, the
 * ledger now describes a schema nobody else can reproduce — and every later
 * `migrate deploy` will skip that migration. The scope is deliberately
 * narrow: `packages/database/prisma`, because a dirty README is not a reason
 * to block a migration.
 *
 * When git is unavailable — a shallow container build, a tarball, a CI image
 * that copied the tree — the guard reports that it was skipped and continues.
 * A guard that cannot run must say so; it must never pass silently, and it
 * must never be the thing that hangs the pipeline.
 */
import { git } from "../prisma";

/** What the guard is allowed to look at. */
export const DEFAULT_SCOPE = "packages/database/prisma";

export type CleanTreeState = "clean" | "dirty" | "skipped";

export interface CleanTreeResult {
  readonly state: CleanTreeState;
  /** Porcelain paths, when dirty. */
  readonly files: readonly string[];
  /** Why it was skipped, when skipped. */
  readonly reason?: string;
}

export async function requireCleanTree(
  scope: string = DEFAULT_SCOPE,
): Promise<CleanTreeResult> {
  let output: string;
  let code: number;
  try {
    const result = await git(["status", "--porcelain", "--", scope]);
    output = result.stdout;
    code = result.code;
  } catch (err) {
    return {
      state: "skipped",
      files: [],
      reason: `git is unavailable (${(err as Error).message})`,
    };
  }

  if (code !== 0) {
    return {
      state: "skipped",
      files: [],
      reason: `git status exited ${code}: ${output.trim() || "no output"}`,
    };
  }

  const files = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

  return files.length === 0
    ? { state: "clean", files: [] }
    : { state: "dirty", files };
}

export function assertCleanTree(result: CleanTreeResult, scope = DEFAULT_SCOPE): void {
  if (result.state === "clean") {
    console.log(`[migrate] guard require-clean-tree: ${scope} is clean`);
    return;
  }
  if (result.state === "skipped") {
    console.warn(
      `[migrate] guard require-clean-tree SKIPPED: ${result.reason ?? "unknown"}. ` +
        "Committing the schema is unverified for this run.",
    );
    return;
  }
  throw new Error(
    `${scope} has uncommitted changes, so the migration history does not ` +
      `describe the schema on disk:\n  ${result.files.join("\n  ")}\n` +
      "Commit or stash them first.",
  );
}
