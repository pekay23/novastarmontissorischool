/**
 * `setup-link` -- mint and print the one-time "set your password" link for an
 * account that has no password yet.
 *
 * WHY THIS EXISTS
 * ---------------
 * `RESEND_API_KEY` is unset in some environments, so `sendEmail` in
 * `packages/notifications` throws `EmailDeliveryError('not-configured')`. Staff
 * account creation still commits its `User` and `Staff` rows and then answers
 * `502 created-not-delivered`, so the "set my password" journey cannot be
 * completed or tested at all. There is no manual workaround: `issueEmailToken`
 * stores `hashEmailToken(token)` -- a SHA-256 digest -- in `User.verifyToken`, so
 * the link cannot be reconstructed from the database, and neither invite route
 * returns the token on failure. `novastar-tenant user --rotate` recovers, but it
 * sets the password directly and therefore bypasses the journey under test.
 *
 * This command mints the link the invite would have emailed and prints it. That is
 * the whole of it: one row update, one line on the operator's own stdout.
 *
 * WHAT WAS CONSIDERED AND REJECTED
 * --------------------------------
 * Both alternatives put a live single-use credential somewhere worse than a
 * terminal, and both were rejected before this file was written:
 *
 *   - **An unauthenticated route that serves message bodies.** A
 *     network-reachable secret store. `packages/notifications/index.ts`
 *     deliberately refuses to attach `options` to its errors precisely because an
 *     auth email's body embeds a single-use token in its action URL, so echoing
 *     the payload into a log would write a working credential to disk.
 *   - **A development mail sink on stdout.** Better than an endpoint, but still a
 *     credential in a log, and a CI or E2E job that ships its log somewhere shared
 *     turns it into the endpoint again.
 *
 * A terminal that already holds `DATABASE_URL` is the right place for a credential
 * that already exists on disk as a digest: the operator has the authority to mint
 * one, and they see it exactly once.
 *
 * THE SECURITY PROPERTIES, AND WHY EACH IS HERE
 * ---------------------------------------------
 * 1. **Refuses an account that already has a `passwordHash`.** This mirrors
 *    `apps/portal/app/api/auth/set-password/route.ts`, which answers `409
 *    already-has-password`. Without this the command is a password reset available
 *    to anyone who can run the CLI, which sidesteps the emailed-link control
 *    entirely: the set-password route refuses to overwrite an existing password,
 *    and the CLI must not be the way around it.
 * 2. **Refuses a non-local database host without an explicit acknowledgement.**
 *    `tools/migrate`'s `baseline` guards its writes with `--allow-production`; this
 *    is the same shape. `tools/migrate`'s `reset --dev-only`, which requires a
 *    local host and no flag, is deliberately *not* copied: `.env.example` records
 *    that the Prisma client speaks Neon's SQL-over-HTTP protocol, so a local
 *    `postgres` cannot serve this schema and a local-host-only gate can never open
 *    against the real database. It would be a gate that always refuses, and an
 *    always-refusing gate gets worked around rather than obeyed.
 * 3. **Never accepts a token on the command line.** `--token` is refused by name,
 *    and so is every positional, because `argv` is world-readable and shell history
 *    keeps it. There is no code path here that reads a token from anywhere but
 *    `issueEmailToken`.
 * 4. **Never writes the token to a file.** Nothing in this module opens a file, and
 *    there is deliberately no `--json` form: this command's only product is a
 *    credential, and a machine-readable one invites `> file`. It writes one row --
 *    `verifyToken` and `verifyTokenExpires` -- and prints.
 * 5. **Never lets the token reach an error.** Anything thrown after the token
 *    exists is rebuilt with the token replaced (see `redactSetupToken`), for the
 *    same reason `EmailDeliveryError` carries no `options`.
 *
 * Set `RESEND_API_KEY` and none of this is needed.
 */
import {
  EMAIL_TOKEN_TTL_HOURS,
  inviteActionUrl,
  issueEmailToken,
} from "@novastar/auth/invite";
import { databaseHost, getPrisma, isLocalHost } from "../config";
import { out } from "../output";
import { ValidationError, validateEmail } from "../validate";
import { UsageError, requireConfirmation, resolveTenantCode, type ArgMap } from "./shared";

export const SETUP_LINK_HELP = `Usage: novastar-tenant setup-link [--tenant <code>] --email <email> [--allow-remote-database] [--yes]

Mints the one-time "set your password" link for an account that has no password
yet, and prints it. Use it to finish an account-setup journey by hand when no
email provider is configured.

THIS IS A DEVELOPMENT AID, NOT THE PRODUCTION PATH. Set RESEND_API_KEY in .env
(see .env.example) and the portal and the super-admin console deliver this link
by email, and nothing here is needed. With the key unset, every account creation
ends "created, not delivered" and the recipient has no way forward.

The printed URL is a single-use credential: following it sets the password for
that account. It goes to your terminal and nowhere else. Only its SHA-256 digest
is stored, in User.verifyToken, so the plaintext cannot be recovered from the
database afterwards -- re-run this command to mint another link.

Options:
  --tenant <code>           tenant code (default: TENANT_CODE)
  --email <email>           an account on that tenant with no password yet (required)
  --allow-remote-database   acknowledge that DATABASE_URL is not on this machine
  --yes                     required when stdin is not a terminal

Refuses an account that already has a password. Reset one with
\`novastar-tenant user --rotate\` instead. There is deliberately no --token
option (it would end up in shell history) and no --json form (it would end up in
a file).`;

/** Stands in for the token in any text this command has to print or throw. */
export const TOKEN_PLACEHOLDER = "[setup token redacted]";

/**
 * Replaces every occurrence of `token` in `text`.
 *
 * The only thing standing between a minted credential and a CI log, so it is
 * exported and tested on its own rather than trusted: a guard that is only ever
 * exercised by a failure nobody can provoke is a guard that does not work.
 */
export function redactSetupToken(text: string, token: string): string {
  if (token.length === 0) return text;
  return text.split(token).join(TOKEN_PLACEHOLDER);
}

/**
 * Where the recipient's setup link points.
 *
 * `NEXTAUTH_URL` first, because that is the portal's own canonical public origin;
 * `NEXT_PUBLIC_ORIGIN` as the fallback for a setup that has only the public one.
 * A link built from the wrong origin is a link that 404s in the recipient's
 * browser, which for a single-use token is a support call.
 *
 * Duplicated as a literal from `apps/portal/lib/auth/school-lookup.ts` and
 * `apps/super-admin/lib/invite-user.ts`, which both already carry their own copy,
 * for the reason `commands/operator.ts` gives for its minimum password length:
 * those modules live inside Next.js apps behind a `@/` path alias and a
 * `server-only` marker, and reaching them from a Bun program with neither would
 * mean a dependency from the tool to an app. Two environment variables is a
 * cheaper thing to duplicate than that edge, and the two copies already agree.
 *
 * Resolved *before* the token is minted, so a missing origin cannot leave a live
 * credential on the row that nothing can be delivered for.
 */
export function portalOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.NEXTAUTH_URL || env.NEXT_PUBLIC_ORIGIN;
  if (!configured) {
    throw new Error(
      "Neither NEXTAUTH_URL nor NEXT_PUBLIC_ORIGIN is set, so no setup link can be " +
        "built. Set NEXTAUTH_URL to the portal origin in .env (see .env.example).",
    );
  }
  return configured.replace(/\/$/, "");
}

/**
 * The remote-host gate, in one testable place. Throws with the reason.
 *
 * A local host is not proof the database is a developer's own -- `--allow-remote-database`
 * is simply never needed there, which is the ergonomic difference. The flag is not
 * an authorisation decision the way `--allow-production` is, because possession of
 * `DATABASE_URL` already is one (see README.md); it is an acknowledgement that
 * this command mints a live credential in a database that is not on this machine.
 */
export function assertRemoteDatabaseAllowed(host: string, allowRemote: boolean): void {
  if (isLocalHost(host)) return;
  if (allowRemote) return;
  throw new UsageError(
    `Refusing to mint a setup link against ${host}: it is not a local address. ` +
      "This command writes a live single-use credential, so it must be acknowledged " +
      "explicitly. Re-run with --allow-remote-database once you have read that.",
  );
}

/**
 * Refuses the two inputs that would put a credential on `argv`.
 *
 * `--token` is named explicitly because "this command does not read a token" is
 * invisible to the person who tried to pass one, and the error is the only place
 * they will be told. It quotes neither the flag's value nor the positional, since
 * a pasted link carries the token.
 */
function assertNoTokenOnArgv(args: ArgMap): void {
  if (args.flag("token")) {
    throw new UsageError(
      "This command mints its own token and will not accept one. Passing it on the " +
        "command line puts a live credential in shell history and in the process table.",
    );
  }
  if (args.positionals.length > 0) {
    throw new UsageError(
      "Unexpected argument. This command takes named options only (--tenant, --email, " +
        "--allow-remote-database, --yes), not positional values. The value given is not " +
        "echoed here because it may be a setup link.",
    );
  }
}

export async function runSetupLink(args: ArgMap): Promise<void> {
  assertNoTokenOnArgv(args);

  const code = resolveTenantCode(args);
  // Lowercased because `User.email` is stored that way -- `normaliseEmail` in
  // `@novastar/auth/invite` folds it on every invited row -- and
  // `@@unique([tenantId, email])` is a byte comparison, so an un-folded address
  // misses a row that exists.
  const email = validateEmail(args.require("email"), "--email").toLowerCase();
  const allowRemote = args.boolean("allow-remote-database");

  // Every refusal that can be decided without a credential is decided first, and
  // the host gate comes before the first read: a database this command was not
  // acknowledged for is not contacted at all.
  const host = databaseHost();
  assertRemoteDatabaseAllowed(host, allowRemote);

  const db = getPrisma();

  const tenant = await db.tenant.findUnique({ where: { code }, select: { id: true } });
  if (!tenant) {
    throw new ValidationError([{ path: "--tenant", message: `No tenant with code "${code}".` }]);
  }

  // Scoped to the resolved tenant, never by email alone: the same address can
  // exist in two tenants, and an unscoped lookup would mint a link for the wrong
  // school's account.
  const user = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    select: { id: true, isActive: true, passwordHash: true },
  });
  if (!user) {
    throw new ValidationError([
      { path: "--email", message: `No account for ${email} on ${code}. Nothing was written.` },
    ]);
  }

  // The load-bearing refusal. `POST /api/auth/set-password` answers `409
  // already-has-password` for exactly this row, so a link minted for it would be
  // refused at the far end; minting it anyway would be pointless, and a command
  // that minted one without the hash check would be a reset path around the
  // emailed-link control.
  if (user.passwordHash) {
    throw new ValidationError([
      {
        path: "--email",
        message:
          `${email} already has a password, so it is not in the invited state this link ` +
          "completes. Nothing was written. Reset the password with " +
          "`novastar-tenant user --rotate` instead.",
      },
    ]);
  }

  // Before the write, not after: see `portalOrigin`.
  const origin = portalOrigin();

  await requireConfirmation(args, `mint a password setup link for ${email} on ${code}`);

  // One row, two columns: the digest and its deadline. `issueEmailToken` mints the
  // token internally, so nothing that could hold the plaintext has existed yet.
  //
  // A failure here is rethrown unchanged on purpose. It comes from Prisma, and
  // `index.ts` prints `error.message` rather than the whole object, so nothing
  // resembling the payload is echoed -- the same reasoning as
  // `describeProviderError` in `packages/notifications`. The unique index on
  // `verifyToken` could, in any case, only ever carry the digest.
  const { token, expiresAt } = await issueEmailToken(user.id);

  try {
    const url = inviteActionUrl(origin, token);
    out.success(`Minted a password setup link for ${email} on ${code}`);
    out.line("");
    out.line(url);
    out.line("");
    out.warn(
      "That URL is a single-use credential. Whoever follows it can choose the password " +
        `for ${email}, and it stops working the first time it is used or at ` +
        `${expiresAt.toISOString()} (about ${EMAIL_TOKEN_TTL_HOURS} hours from now).`,
    );
    out.line(
      "Only its SHA-256 digest is stored, so it cannot be recovered from the database " +
        "afterwards. Re-run this command to mint another link; the newest one wins.",
    );
    out.line(
      "Do not paste it into a ticket, a chat or a CI log. Setting RESEND_API_KEY is the " +
        "real fix, after which this command is unnecessary.",
    );
    if (!user.isActive) {
      out.warn(
        `${email} is inactive, so the link will work but the account will not sign in ` +
          "until it is reactivated.",
      );
    }
  } catch (error) {
    // The only code below this line that has ever held the plaintext, and the only
    // place an exception could therefore pick it up. The credential is already on
    // the row, so this does not roll anything back; it says so, and tells the
    // operator the honest recovery, which is a fresh run.
    throw new Error(
      redactSetupToken(
        `The setup link for ${email} on ${code} was minted and stored, but printing it ` +
          `failed: ${error instanceof Error ? error.message : String(error)}. The row now ` +
          "holds a digest nobody can read; re-run this command to mint a fresh link.",
        token,
      ),
    );
  }
}