/**
 * Refuses to migrate a database that has no usable restore point.
 *
 * Two of the three checks have real teeth and need no cooperation:
 *
 *   - **Reachability.** If `SUPABASE_DATABASE_URL` is configured and the
 *     failsafe cannot be reached, there is no restore point. That refuses.
 *   - **Coverage.** Every table in the primary must exist in the failsafe. A
 *     mirror missing tables is not a backup, and this names which ones.
 *
 * The third check, age, cannot be measured honestly from inside this tool:
 * `tools/db-mirror` leaves no run marker, and nothing in Postgres records when
 * a `TRUNCATE`/`INSERT` mirror last ran. Rather than invent a signal, the guard
 * uses the newest ledger `finished_at` in the failsafe when there is one, or
 * an operator attestation (`--mirror-synced-at`), and when neither is
 * available it says the age is unknown and continues. Unknown is logged
 * loudly, and `--require-mirror-age` turns it into a refusal for anyone who
 * would rather not take the risk.
 */
import { resolveMirror, type Target } from "../env";
import { openReadOnly, type Queryable } from "../fingerprints/tables";
import { warn } from "../log";

export interface BackupOptions {
  /** Refuse when the mirror is older than this. Default 24. */
  readonly maxAgeHours: number;
  /** Operator attestation: when the mirror was last confirmed current. */
  readonly mirrorSyncedAt?: string;
  /** Treat "age unknown" as a refusal. */
  readonly requireAge: boolean;
  /** Injectable for tests. */
  readonly connect?: (url: string) => Promise<ClosableQueryable>;
}

/** A read-only handle that has to be closed. */
export type ClosableQueryable = Queryable & { end(): Promise<void> };

export interface BackupResult {
  readonly ok: boolean;
  /** Why it refused, or why it did not need to check. */
  readonly reason: string;
  readonly missingTables?: readonly string[];
  readonly ageHours?: number | null;
}

export type AgeVerdict =
  | { readonly ok: true; readonly ageHours: number; readonly source: string }
  | { readonly ok: false; readonly ageHours: number | null; readonly source: string; readonly reason: string };

/**
 * Age arithmetic, separated from everything that touches a socket so it can be
 * tested exactly.
 */
export function evaluateMirrorAge(
  known: Date | string | undefined,
  now: Date,
  maxAgeHours: number,
): AgeVerdict {
  if (known === undefined) {
    return {
      ok: false,
      ageHours: null,
      source: "unknown",
      reason:
        "no mirror timestamp is available: the failsafe has no _prisma_migrations " +
        "ledger and --mirror-synced-at was not passed",
    };
  }
  const at = typeof known === "string" ? new Date(known) : known;
  if (Number.isNaN(at.getTime())) {
    return {
      ok: false,
      ageHours: null,
      source: "invalid",
      reason: `the supplied mirror timestamp is not a date: ${String(known)}`,
    };
  }
  const ageHours = (now.getTime() - at.getTime()) / 3_600_000;
  if (ageHours < 0) {
    return {
      ok: false,
      ageHours,
      source: "future",
      reason: `the supplied mirror timestamp is in the future (${at.toISOString()})`,
    };
  }
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      ageHours,
      source: "ledger",
      reason:
        `the failsafe is ${ageHours.toFixed(1)}h old, past the ` +
        `${maxAgeHours}h limit. Run \`bun run db:mirror\` first.`,
    };
  }
  return { ok: true, ageHours, source: "ledger" };
}

const LATEST_LEDGER_SQL =
  `SELECT max(finished_at) AS latest FROM _prisma_migrations WHERE finished_at IS NOT NULL`;

async function latestLedgerAt(q: Queryable): Promise<Date | undefined> {
  const { rows } = await q.query(LATEST_LEDGER_SQL);
  const value = (rows[0] as { latest?: unknown } | undefined)?.latest;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

async function tableNames(q: Queryable): Promise<string[]> {
  const { rows } = await q.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  return rows.map((r) => (r as { table_name: string }).table_name);
}

/** Fail-closed when a failsafe is configured. Silent when it is not. */
export async function requireBackup(
  primary: Target,
  env: NodeJS.ProcessEnv,
  options: BackupOptions,
): Promise<BackupResult> {
  const mirror = resolveMirror(env);
  if (!mirror) {
    warn(
      "SUPABASE_DATABASE_URL is not set, so there is no failsafe to check. " +
        "Proceeding without a restore point.",
    );
    return { ok: true, reason: "no mirror configured" };
  }

  const connect: (url: string) => Promise<ClosableQueryable> =
    options.connect ??
    // `pg`'s Client is structurally compatible; the cast only sidesteps its
    // nine `query` overloads, which no single signature can satisfy.
    ((url: string) => openReadOnly(url) as unknown as Promise<ClosableQueryable>);
  let mirrorClient: ClosableQueryable | undefined;
  let primaryClient: ClosableQueryable | undefined;
  try {
    primaryClient = await connect(primary.url);
  } catch (err) {
    return {
      ok: false,
      reason: `could not read the primary at ${primary.host}: ${(err as Error).message}`,
    };
  }

  try {
    mirrorClient = await connect(mirror.url);
  } catch (err) {
    await primaryClient.end().catch(() => undefined);
    return {
      ok: false,
      reason:
        `the failsafe at ${mirror.host} is unreachable, so there is no restore ` +
        `point: ${(err as Error).message}`,
    };
  }

  try {
    const [primaryTables, mirrorTables] = await Promise.all([
      tableNames(primaryClient),
      tableNames(mirrorClient),
    ]);
    const have = new Set(mirrorTables);
    const missing = primaryTables.filter((t) => !have.has(t));
    if (missing.length > 0) {
      return {
        ok: false,
        missingTables: missing,
        reason:
          `the failsafe is missing ${missing.length} table(s) present in the ` +
          `primary: ${missing.join(", ")}. A mirror missing tables is not a backup.`,
      };
    }

    const known = options.mirrorSyncedAt ?? (await latestLedgerAt(mirrorClient));
    const verdict = evaluateMirrorAge(known, new Date(), options.maxAgeHours);
    if (!verdict.ok && options.requireAge) {
      return { ok: false, reason: verdict.reason, ageHours: verdict.ageHours };
    }
    if (!verdict.ok) {
      warn(`${verdict.reason}. Continuing because --require-mirror-age was not set.`);
      return { ok: true, reason: "mirror reachable and complete; age unknown", ageHours: null };
    }
    return {
      ok: true,
      reason: `failsafe is ${verdict.ageHours.toFixed(1)}h old and covers all ${primaryTables.length} tables`,
      ageHours: verdict.ageHours,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `could not compare the failsafe with the primary: ${(err as Error).message}`,
    };
  } finally {
    await Promise.all([
      mirrorClient?.end().catch(() => undefined),
      primaryClient.end().catch(() => undefined),
    ]);
  }
}

export function assertBackup(result: BackupResult): void {
  if (result.ok) {
    console.log(`[migrate] guard require-backup: ${result.reason}`);
    return;
  }
  throw new Error(`no usable restore point: ${result.reason}`);
}
