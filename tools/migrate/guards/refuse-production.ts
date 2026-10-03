/**
 * Refuses to treat production as anything other than production.
 *
 * The classification is deliberately asymmetric: **an unrecognised host is
 * production.** A new managed database host nobody has added to an allowlist
 * therefore gets the full guard, not a bypass. The only way to say "this is
 * not production" is to say so explicitly with `--target dev`, and that
 * declaration is echoed into the log so it is visible in CI output.
 *
 * `SKIP_PRODUCTION_GUARD` is honoured only where the caller passes
 * `honourEscapeHatch: true` — the guarded deploy. `reset` does not pass it,
 * and never will: that command drops a schema, and a variable in the
 * environment is not a decision a person made.
 */
import { isLocalHost, redact, type Target } from "../env";

export type TargetLabel = "prod" | "dev";

export interface ClassifyOptions {
  /** `--target prod` / `--target dev`, when the operator declared one. */
  readonly declared?: TargetLabel;
  /** `SKIP_PRODUCTION_GUARD=1` in the environment. */
  readonly escapeHatch?: boolean;
}

export interface Verdict {
  readonly production: boolean;
  readonly reason: string;
}

export function classifyTarget(target: Target, options: ClassifyOptions = {}): Verdict {
  const local = isLocalHost(target.host);

  if (options.declared === "prod") {
    return { production: true, reason: "--target prod was declared" };
  }
  if (local) {
    return {
      production: false,
      reason: `${target.host} is a local address`,
    };
  }
  if (options.declared === "dev") {
    return {
      production: false,
      reason:
        `--target dev was declared for the non-local host ${target.host}; ` +
        "this is recorded in the output and is the operator's call to make",
    };
  }
  return {
    production: true,
    reason:
      `${target.host} is not a local address and nothing declared it otherwise; ` +
      "unrecognised hosts are treated as production",
  };
}

/**
 * Throws unless the operator both acknowledged production (`--allow-production`
 * or `SKIP_PRODUCTION_GUARD`) and confirmed at a TTY or with `--yes`.
 */
export async function assertProductionAllowed(
  target: Target,
  options: ClassifyOptions & {
    readonly allowProduction: boolean;
    readonly yes: boolean;
    readonly honourEscapeHatch: boolean;
    readonly confirm: () => Promise<boolean>;
  },
): Promise<void> {
  const verdict = classifyTarget(target, {
    declared: options.declared,
    escapeHatch: options.escapeHatch,
  });
  if (!verdict.production) {
    console.log(`[migrate] not a production target: ${verdict.reason}`);
    return;
  }

  if (!options.allowProduction) {
    throw new Error(
      `refusing to touch a production database (${redact(target.url)}, ` +
        `${target.source}): ${verdict.reason}.\n` +
        "Re-run with --allow-production to acknowledge it, or --target dev to " +
        "declare a non-production environment.",
    );
  }

  console.warn(
    `[migrate] PRODUCTION target acknowledged: ${redact(target.url)} (${target.source})`,
  );

  if (options.honourEscapeHatch && options.escapeHatch === true) {
    console.warn(
      "[migrate] SKIP_PRODUCTION_GUARD=1 is set, so the confirmation is skipped. " +
        "This is the documented escape hatch, not a default.",
    );
    return;
  }

  const ok = await options.confirm();
  if (!ok) {
    throw new Error("production change was not confirmed; nothing was run");
  }
}
