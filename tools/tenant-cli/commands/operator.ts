/**
 * `operator` -- create the first platform operator, or reset an existing one's password.
 *
 * This is the break-glass path that `SUPER_ADMIN_SECRET` used to be. Before
 * per-operator accounts, losing every operator password was unrecoverable without
 * rotating a shared secret, which meant telling every other operator to sign in
 * again, and there was no way to say *who* had been rotated. Here the recovery is a
 * row on `PlatformOperator`, attributed like any other identity, and resetting one
 * person's password touches nobody else's session.
 *
 * Conventions copied from `commands/user.ts`, deliberately, because the two commands
 * have the same shape and a CLI with two idioms is worse than one:
 *
 * - The password comes from `PLATFORM_OPERATOR_PASSWORD` or a masked prompt. There
 *   is no default, no command-line option and nothing echoed to stdout: a password
 *   on `argv` is visible to every process on the machine, and a known default is a
 *   backdoor. `tools/seed` has that fallback; it is not copied here.
 * - A mutating command is gated on `requireConfirmation`, which demands the
 *   description be typed on a terminal and `--yes` anywhere else.
 *
 * WHY THIS IS IN `tenant-cli` AT ALL
 * ----------------------------------
 * It is a different table, a different schema and a different blast radius from
 * everything else in this tool, and the honest reason it lives here anyway is that
 * `novastar-tenant` is the one command in the repository that already knows how to
 * read a secret without printing it, hash with argon2id, and require confirmation
 * before writing a credential. Duplicating all three to keep a table in one place
 * would be the less safe outcome.
 */
import { PermissionKeySchema } from "@novastar/shared-types";
import { getPrisma } from "../config";
import { out } from "../output";
import { hashPassword } from "../provision";
import { ValidationError, validateEmail } from "../validate";
import { requireConfirmation, readSecret, type ArgMap } from "./shared";

/**
 * Matches `MIN_OPERATOR_PASSWORD_LENGTH` in
 * `apps/super-admin/lib/operator-password.ts`.
 *
 * Duplicated as a literal rather than imported, and that duplication is the lesser
 * evil: the console is a Next.js app with a `@/` path alias and the CLI is a Bun
 * program without one, so importing across the boundary would mean either adding a
 * dependency from the tool to the app or reaching through a relative path out of
 * this workspace. The test that matters is the one that would catch the two
 * drifting, and the console refuses to sign anyone in below its own floor, so a
 * drift shows up as an account that cannot be used rather than as a weak one.
 */
export const MIN_OPERATOR_PASSWORD_LENGTH = 6;

/**
 * The composition rules an operator password must satisfy on top of the length
 * floor. Kept identical in spirit to the portal's `PASSWORD_COMPLEXITY` —
 * uppercase, lowercase, digit and symbol — because an operator credential
 * reaches every tenant in the fleet and deserves the same baseline as a school
 * administrator's. Duplicated as a literal rather than imported for the same
 * reason as the minimum length: this is a Bun CLI without the console's `@/`
 * alias, and importing across that boundary would mean adding a dependency
 * from the tool to the app.
 */
export const OPERATOR_PASSWORD_COMPLEXITY = {
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: true,
} as const;

export function meetsOperatorPasswordComplexity(password: string): boolean {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (OPERATOR_PASSWORD_COMPLEXITY.requireUppercase && !hasUpper) return false;
  if (OPERATOR_PASSWORD_COMPLEXITY.requireLowercase && !hasLower) return false;
  if (OPERATOR_PASSWORD_COMPLEXITY.requireDigit && !hasDigit) return false;
  if (OPERATOR_PASSWORD_COMPLEXITY.requireSymbol && !hasSymbol) return false;

  return true;
}

export const OPERATOR_PASSWORD_ENV_VAR = "PLATFORM_OPERATOR_PASSWORD";

/**
 * Where the console's authoritative capability vocabulary lives.
 *
 * `OPERATOR_CAPABILITIES` in `apps/super-admin/lib/permissions.ts`, which cannot be
 * imported from here for the same reason as the minimum length. The list is
 * therefore not duplicated in this file either — it is named in the help text and
 * the console narrows any stored key it does not recognise away at sign-in, so a
 * typo in a grant is inert rather than dangerous.
 */
const CAPABILITY_VOCABULARY_HINT =
  "apps/super-admin/lib/permissions.ts (OPERATOR_CAPABILITIES): platform:read, platform:audit, " +
  "tenant:read, tenant:update, tenant:provision, tenant:config, tenant:user:read, " +
  "tenant:user:create";

export const OPERATOR_HELP = `Usage: novastar-tenant operator --username <name> --email <email> --capabilities <list> [--name <display>] [--rotate] [--keep-password]

Creates a PlatformOperator row for apps/super-admin, or resets the password of an
existing one. An operator belongs to no tenant and has no school role.

This is the bootstrap and recovery path. It is the only way to create an operator,
by design: the console's own UI cannot mint one, because anything that can write
the operator table is already inside the thing the table protects.

The password comes from ${OPERATOR_PASSWORD_ENV_VAR} or a masked prompt. There is no
default password and no command-line option.

Options:
  --username <name>      the operator's username (required)
  --email <email>        the operator's email (required)
  --name <display>       human-readable name, shown in the console header
  --capabilities <list>  comma-separated grants (required). Vocabulary: ${CAPABILITY_VOCABULARY_HINT}
  --rotate               set a new password on an existing operator instead of creating one
  --keep-password        do NOT require a change at first sign-in
  --yes                  required when stdin is not a terminal
  --json                 print the result as JSON`;

/**
 * Splits and validates a comma-separated grant list.
 *
 * Validated with `PermissionKeySchema` -- the same parser every seeded
 * `Permission.key` in the platform goes through -- rather than against the console's
 * operator list, which this module cannot import. That is the weaker check by one
 * step: it permits a key the console will silently drop at sign-in. Refusing a key
 * the *platform* has never heard of is still worth doing, because a grant nobody can
 * use is a bug in the recovery path an operator will not notice until it matters.
 */
function parseCapabilities(raw: string): string[] {
  const capabilities = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (capabilities.length === 0) {
    throw new ValidationError([
      {
        path: "--capabilities",
        message:
          "Required, and not defaulted: a grant list is an authorisation decision. " +
          `Take the keys from ${CAPABILITY_VOCABULARY_HINT}.`,
      },
    ]);
  }

  const invalid = capabilities.filter((key) => !PermissionKeySchema.safeParse(key).success);
  if (invalid.length > 0) {
    throw new ValidationError([
      { path: "--capabilities", message: `Not valid platform permission keys: ${invalid.join(", ")}. Nothing was written.` },
    ]);
  }

  return [...new Set(capabilities)];
}

export async function runOperator(args: ArgMap): Promise<void> {
  const username = args.require("username").trim().toLowerCase();
  const email = validateEmail(args.require("email"), "--email").toLowerCase();
  const displayName = args.get("name")?.trim();
  const capabilities = parseCapabilities(args.require("capabilities"));
  const rotate = args.flag("rotate");
  const keepPassword = args.flag("keep-password");
  const db = getPrisma();

  // Both halves of the identifier are looked up, not just one. The login path
  // resolves either, so an operator created here with a username that collides with
  // somebody else's email would be permanently unloginable -- the console refuses an
  // ambiguous identifier rather than picking a row.
  const [byUsername, byEmail] = await Promise.all([
    db.platformOperator.findUnique({ where: { username }, select: { id: true, username: true, email: true } }),
    db.platformOperator.findUnique({ where: { email }, select: { id: true, username: true, email: true } }),
  ]);

  // `create` and `--rotate` disagree about what a row already matching the identifier
  // means, so the collision rules are not shared. On create, any match is a refusal.
  // On rotate, a match is the *subject* -- and requiring both halves to name the same
  // row is what stops `--rotate` from silently resetting the wrong account when one
  // person's username and another's email both resolve.
  let existing: { id: string; username: string; email: string } | null = null;

  if (rotate) {
    if (!byUsername && !byEmail) {
      throw new ValidationError([
        {
          path: "--rotate",
          message: `No operator with username "${username}" or email "${email}". Drop --rotate to create one.`,
        },
      ]);
    }
    if (byUsername && byEmail && byUsername.id !== byEmail.id) {
      throw new ValidationError([
        {
          path: "--rotate",
          message: `--username "${username}" and --email "${email}" are different operators. Name one account, not two.`,
        },
      ]);
    }
    existing = byUsername ?? byEmail;
  } else {
    const collisions = [
      byUsername ? `--username "${username}" is already the operator ${byUsername.username}. Use --rotate to reset a password.` : null,
      byEmail ? `--email "${email}" already belongs to another operator.` : null,
    ].filter((issue): issue is string => issue !== null);

    if (collisions.length > 0) {
      throw new ValidationError([{ path: "--username", message: collisions.join(" ") }]);
    }
  }

  const password = await readSecret(OPERATOR_PASSWORD_ENV_VAR, `Password for ${username}`);
  if (password.length < MIN_OPERATOR_PASSWORD_LENGTH) {
    throw new ValidationError([
      {
        path: "password",
        message: `Must be at least ${MIN_OPERATOR_PASSWORD_LENGTH} characters. Nothing was written.`,
      },
    ]);
  }
  if (!meetsOperatorPasswordComplexity(password)) {
    throw new ValidationError([
      {
        path: "password",
        message:
          `Must contain an uppercase letter, a lowercase letter, a number and a symbol. ` +
          `Nothing was written.`,
      },
    ]);
  }

  await requireConfirmation(args, rotate ? `reset the password for ${username}` : `create ${username}`);

  // `hashPassword` is the shared argon2id helper, so an operator hash is written by
  // exactly the same primitive as a tenant administrator's. It runs on Bun, which
  // picks its own cost parameters, and the console's `argon2.verify` reads those back
  // out of the stored PHC string -- which is why the two verify each other despite
  // naming different numbers. Reimplementing a second hasher here to match the
  // console's constants exactly would have bought nothing and cost a dependency.
  const passwordHash = await hashPassword(password);

  if (existing) {
    // Resets the lockout as a side effect, and that is the point: an operator locked
    // out of the console cannot sign in to clear their own counter, so a reset that
    // left the lock in place would be a recovery path that does not recover.
    const updated = await db.platformOperator.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        mustChangePassword: !keepPassword,
        passwordChangedAt: new Date(),
        loginAttempts: 0,
        lockedUntil: null,
      },
      select: { id: true, username: true, email: true, status: true },
    });

    if (args.flag("json")) {
      out.json({ action: "reset", ...updated, capabilities });
      return;
    }
    out.success(`Password reset for ${updated.username}`);
    if (keepPassword) {
      out.line("The password will not be required to change at first sign-in.");
    } else {
      out.line("The password was not printed. It must be changed at first sign-in.");
    }
    return;
  }

  const created = await db.platformOperator.create({
    data: {
      username,
      email,
      name: displayName && displayName.length > 0 ? displayName : null,
      passwordHash,
      capabilities,
      mustChangePassword: !keepPassword,
      passwordChangedAt: new Date(),
      status: "ACTIVE",
    },
    select: { id: true, username: true, email: true, name: true, status: true },
  });

  if (args.flag("json")) {
    out.json({ action: "created", ...created, capabilities });
    return;
  }
  out.success(`Created operator ${created.username} (${created.email})`);
  // The list just written, rather than a re-read: `select` above asks only for the
  // columns the summary line needs, and echoing back what was granted is what the
  // operator has to verify by eye.
  out.table(capabilities, [{ header: "Capability", value: (key) => key }]);

  if (keepPassword) {
    // The one warning this command issues, and it is not a formality: every other
    // path into an account sets `mustChangePassword`, because everywhere else the
    // password was chosen by one person and handed to another. This flag is the only
    // way to create an operator whose password stays as typed, so it has to say what
    // that costs out loud.
    out.warn(
      "Created with --keep-password: this password will not be required to change, and it was " +
        "chosen outside the console. Anyone who ever saw it still holds console access to every " +
        "tenant until the account is suspended or the password is reset.",
    );
  } else {
    out.line("The password was not printed. It must be changed at first sign-in.");
  }
}