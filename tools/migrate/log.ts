/**
 * Reporting for `@novastar/migrate`.
 *
 * Every command prints the mechanism it used, on success and on failure, so
 * there is never a question about who touched a database. `prisma migrate
 * deploy` says so; a read-only ledger query says so; the Supabase mirror says
 * `@novastar/db-mirror`. A stack trace does not: the failure mode this exists
 * to prevent is a half-applied migration and nobody knowing which command
 * started it.
 *
 * `Context` lives here rather than in `index.ts` because every command needs
 * both the reporting helpers and the shape of what `index.ts` hands it, and
 * `commands/*` importing `index.ts` would be a cycle.
 */

export interface Context {
  /** The subcommand, e.g. `deploy`. */
  readonly command: string;
  /** What actually did the work, e.g. `prisma migrate deploy`. */
  readonly mechanism: string;
  /** `--yes` was passed: never prompt, never block on a TTY. */
  readonly yes: boolean;
  /** `--dry-run` was passed. */
  readonly dryRun: boolean;
  /** The environment to read variables from. Injected so tests stay pure. */
  readonly env: NodeJS.ProcessEnv;
}

const PREFIX = "[migrate]";

/** Starts a command: names the command and the mechanism before any work. */
export function announce(ctx: Context, detail?: string): void {
  console.log(`${PREFIX} ${ctx.command} via ${ctx.mechanism}`);
  if (detail) console.log(`${PREFIX} ${detail}`);
}

export function heading(text: string): void {
  console.log(`\n${text}`);
}

export function line(text = ""): void {
  console.log(text);
}

export function warn(text: string): void {
  console.warn(`${PREFIX} warning: ${text}`);
}

/** A guard that chose not to stop the chain, loudly. Never silently. */
export function skipped(guard: string, why: string): void {
  console.warn(`${PREFIX} guard ${guard} SKIPPED: ${why}`);
}

export function success(ctx: Context, summary: string): void {
  console.log(`${PREFIX} ${ctx.command} OK via ${ctx.mechanism}: ${summary}`);
}

/**
 * The single failure printer. `index.ts` routes every thrown error through
 * here so the mechanism is printed on the failure path too, and so a
 * non-`Error` throw still produces a usable message.
 */
export function failure(ctx: Context, err: unknown): number {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n${PREFIX} ${ctx.command} FAILED via ${ctx.mechanism}`);
  console.error(`${PREFIX} ${message}`);
  return 1;
}
