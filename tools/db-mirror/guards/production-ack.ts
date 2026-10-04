/**
 * The two decisions `apply-schema.ts` makes before it sends any DDL anywhere.
 *
 * They are here, apart from the `pg` client and the readline prompt, so they can
 * be tested without a database, a network, or a terminal. A guard that can only
 * be exercised by applying DDL to production is a guard nobody tests.
 *
 * Both refuse rather than infer. There is no default host, no default
 * acknowledgement, and no `--yes` that reaches either one — `apply-schema`
 * applies a reviewed file to a live school database, so a decision to write
 * there is made by a person, every time.
 */

export type ApplyTarget = "neon" | "supabase";

/**
 * What each target's hostname must contain. Checked so that a variable pointing
 * somewhere unexpected is refused *before* anything connects, rather than
 * discovered after a connection to the wrong database succeeded.
 *
 * Deliberately a substring match on a provider name and not a hostname
 * allowlist: this cannot enumerate every Neon endpoint shape, and pretending
 * otherwise would make the check look stronger than it is.
 */
const EXPECTED_HOST: Record<ApplyTarget, RegExp> = {
  neon: /neon/i,
  supabase: /supabase/i,
};

export function isExpectedHost(target: ApplyTarget, host: string): boolean {
  return EXPECTED_HOST[target].test(host);
}

export interface AckInput {
  readonly target: ApplyTarget;
  readonly host: string;
  /** `--allow-production` was passed. */
  readonly allowProduction: boolean;
  /** A human could answer a prompt here. False in CI and in any script run. */
  readonly hasTty: boolean;
}

/** Why the run may proceed, or why it may not. `null` reason means proceed. */
export interface AckVerdict {
  readonly proceed: boolean;
  /** `flag` = acknowledged on the command line, `prompt` = ask a human now. */
  readonly how: "flag" | "prompt" | null;
  readonly reason: string | null;
}

const PROCEED = (how: "flag" | "prompt"): AckVerdict => ({
  proceed: true,
  how,
  reason: null,
});

/**
 * Whether this run may apply DDL to `host`.
 *
 * Only `neon` is production: it is the live school database. `supabase` is the
 * read-replicated failsafe the mirror restores *into*, so applying a DDL file
 * there is a rebuild rather than a change to a system of record.
 *
 * There is no local-host exemption, and that is a deliberate consequence rather
 * than an omission. `isExpectedHost` has already refused any host that is not a
 * Neon host, so every host that reaches this function is a remote Neon host; a
 * `localhost` exemption could only ever have fired on a name like
 * `neon.localhost`, and a rule that reads as "local clones are exempt" while
 * exempting almost nothing is worse than no rule at all.
 *
 * `hasTty` false with no flag is a refusal rather than a hang. This command is
 * run by CI and by scripts, and a script cannot answer a question.
 */
export function decideProductionAck(input: AckInput): AckVerdict {
  if (isExpectedHost(input.target, input.host) === false) {
    return {
      proceed: false,
      how: null,
      reason: `'${input.target}' was requested but the host is ${input.host}`,
    };
  }

  if (input.target !== "neon") return PROCEED("flag");

  if (input.allowProduction) return PROCEED("flag");

  if (!input.hasTty) {
    return {
      proceed: false,
      how: null,
      reason:
        `the neon target is production (${input.host}) and this session cannot be asked. ` +
        "Pass --allow-production to acknowledge that the DDL is intended.",
    };
  }

  return PROCEED("prompt");
}