/**
 * The one-time email token: what is minted, what is stored, and what the shape
 * gate lets past.
 *
 * The load-bearing property is that the stored form is not a credential. The raw
 * token is 32 bytes of CSPRNG output, one copy of which is emailed and never
 * written down; what goes in `User.verifyToken` is a SHA-256 digest, so a backup,
 * a replica or a support query yields digests that cannot be replayed. Every other
 * assertion here holds up that one: that the digest is deterministic enough for the
 * portal's `authorize()` to find the row, that it is not the token, that the shape
 * gate rejects the stored form and the passkey bridge's `pk_` token, and that a
 * blank is absent rather than a value.
 *
 * Nothing in this file touches a database.
 */
import { describe, expect, test } from "bun:test";
import {
  EMAIL_TOKEN_TTL_HOURS,
  EMAIL_TOKEN_TTL_MS,
  INVITE_TOKEN_TTL_HOURS,
  hashEmailToken,
  isEmailToken,
  mintEmailToken,
} from "../invite";

const MS_PER_HOUR = 60 * 60 * 1000;

/** A large batch, for the properties that are about uniqueness rather than shape. */
const BATCH = 1000;

const batch = (): string[] => Array.from({ length: BATCH }, () => mintEmailToken());

// ---------------------------------------------------------------------------

describe("mintEmailToken issues something unguessable and self-describing", () => {
  test("the token is a 4-character prefix plus 32 bytes of CSPRNG output", () => {
    const token = mintEmailToken();
    expect(token).toMatch(/^vem_[A-Za-z0-9_-]{43}$/);
    // The 43 characters decode to 32 bytes: 256 bits, not a counter, not a
    // timestamp, not a shortened hash of the user id.
    expect(Buffer.from(token.slice("vem_".length), "base64url").length).toBe(32);
  });

  test("the alphabet cannot express a character a URL or a mail header would treat as structure", () => {
    // base64url has no `+`, `/` or `=`, so a token cannot be mangled by a query
    // decoder turning `+` into a space, cannot end a URL path, and cannot add a
    // second header. It is also why `encodeURIComponent` is a no-op on it.
    const token = mintEmailToken();
    for (const structural of ["+", "/", "=", "?", "&", "#", "@", " ", '"']) {
      expect(token).not.toContain(structural);
    }
    expect(encodeURIComponent(token)).toBe(token);
  });

  test("a token carries no account information, so it cannot be read back to an address", () => {
    const token = mintEmailToken();
    expect(token).not.toContain("@");
    // Not the digest of anything either: the shape is fixed, so no identifier is
    // encoded into the value a recipient receives.
    expect(token).not.toBe(hashEmailToken(token));
  });

  test("two mints never collide, so one account's link cannot be another's", () => {
    const tokens = batch();
    expect(new Set(tokens).size).toBe(BATCH);
    expect(new Set(tokens.map(hashEmailToken)).size).toBe(BATCH);
  });

  test("what is minted passes the shape gate, so the gate does not reject this module's own output", () => {
    for (const token of batch().slice(0, 50)) {
      expect(isEmailToken(token)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------

describe("hashEmailToken stores a digest rather than the token", () => {
  test("the digest is 64 lowercase hex characters, which is SHA-256 and not SHA-1 or base64", () => {
    expect(hashEmailToken(mintEmailToken())).toMatch(/^[0-9a-f]{64}$/);
    // Known answers, so a change of algorithm or of encoding fails here rather than
    // silently orphaning every token already on disk.
    expect(hashEmailToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(hashEmailToken(" ")).toBe("36a9e7f1c95b82ffb99743e0c5c4ce95d83c9a430aac59f84ef3cbfab6145068");
    expect(hashEmailToken("vem_known-answer-test-token")).toBe(
      "ec396b1174284c486fe3ed22c4781666d677f75fe3bc9c9b47c586e58f13a820",
    );
  });

  test("hashing is deterministic, which is the only reason the portal's authorize() can find the row", () => {
    // The mint here and the lookup there are two separate pieces of code in two
    // separate bundles. If this transform were salted, randomised or truncated, a
    // link minted by one would resolve for nobody.
    const token = mintEmailToken();
    expect(hashEmailToken(token)).toBe(hashEmailToken(token));
  });

  test("the digest neither is nor contains the token, so the stored form is not a credential", () => {
    const token = mintEmailToken();
    const digest = hashEmailToken(token);
    expect(digest).not.toBe(token);
    expect(digest).not.toContain(token);
    expect(digest).not.toContain("vem_");
    // And the gate agrees: a digest pasted into a setup link is not a token.
    expect(isEmailToken(digest)).toBe(false);
  });

  test("hashing is byte-exact, so a mangled link is a different credential rather than the same one", () => {
    // No trimming and no case folding. A token that picked up a stray space or was
    // upper-cased in transit must not resolve to the row it was minted for, or a
    // support agent retyping a link from a screenshot would hold a working
    // credential nobody issued deliberately.
    const token = mintEmailToken();
    const digest = hashEmailToken(token);
    expect(hashEmailToken(` ${token}`)).not.toBe(digest);
    expect(hashEmailToken(`${token} `)).not.toBe(digest);
    expect(hashEmailToken(token.toUpperCase())).not.toBe(digest);
    expect(hashEmailToken(`\n${token}`)).not.toBe(digest);
  });

  test("a blank hashes to a public constant that no issued token collides with", () => {
    // SHA-256 of nothing is a value anyone can look up, so if a caller ever stored
    // it, one row would hold a credential anyone could compute. It is pinned so
    // that "a blank token hashes to something real" stays visible rather than
    // looking harmless.
    const blank = hashEmailToken("");
    expect(blank).toBe(hashEmailToken(""));
    for (const token of batch()) {
      expect(hashEmailToken(token)).not.toBe(blank);
    }
    // Two different blanks are two different credentials, not one wildcard.
    expect(hashEmailToken("")).not.toBe(hashEmailToken(" "));
  });
});

// ---------------------------------------------------------------------------

describe("isEmailToken refuses everything that is not a token this module issued", () => {
  test("a blank or whitespace-only token is absent, not a value", () => {
    for (const blank of ["", " ", "   ", "\t", "\n", "\r\n"]) {
      expect(isEmailToken(blank)).toBe(false);
    }
  });

  test("a token one character short or one character long is refused", () => {
    const token = mintEmailToken();
    expect(isEmailToken(token.slice(0, -1))).toBe(false);
    expect(isEmailToken(`${token}A`)).toBe(false);
    expect(isEmailToken(`${token} `)).toBe(false);
    expect(isEmailToken(` ${token}`)).toBe(false);
    // The prefix alone, and the body alone, are not tokens either.
    expect(isEmailToken("vem_")).toBe(false);
    expect(isEmailToken(token.slice("vem_".length))).toBe(false);
  });

  test("the prefix is case-sensitive, so a re-cased token is not a token", () => {
    const token = mintEmailToken();
    expect(isEmailToken(`VEM_${token.slice(4)}`)).toBe(false);
    expect(isEmailToken(`vEm_${token.slice(4)}`)).toBe(false);
  });

  test("the passkey bridge's token cannot be mistaken for an email token", () => {
    // `authorize()` routes `pk_` to a different branch entirely, and this prefix is
    // what guarantees the two can never be confused. Same total length as a real
    // token, so only the prefix distinguishes them.
    const bridge = `pk_${"a".repeat(44)}`;
    expect(bridge.length).toBe(mintEmailToken().length);
    expect(isEmailToken(bridge)).toBe(false);
  });

  test("the stored digest and a slice of a real token are both refused", () => {
    const token = mintEmailToken();
    expect(isEmailToken(hashEmailToken(token))).toBe(false);
    expect(isEmailToken(token.slice(4, 20))).toBe(false);
    expect(isEmailToken(token.replace("vem_", "vEm_"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("the lifetime a recipient is told about is the lifetime the row is given", () => {
  test("a link forwarded months later is not a live credential", () => {
    // The source of this number is a judgement, so it is pinned rather than derived:
    // long enough that someone who reads email in the evening can still use the
    // link, short enough that a forwarded one is dead. Raising it is a decision.
    expect(EMAIL_TOKEN_TTL_MS).toBe(24 * MS_PER_HOUR);
    expect(Number.isFinite(EMAIL_TOKEN_TTL_MS)).toBe(true);
    expect(EMAIL_TOKEN_TTL_MS).toBeGreaterThan(0);
    expect(EMAIL_TOKEN_TTL_HOURS).toBe(24);
    expect(INVITE_TOKEN_TTL_HOURS).toBe(EMAIL_TOKEN_TTL_HOURS);
  });

  test("the hours in the email and the milliseconds on the row are one window", () => {
    // Three constants, one definition. Editing one of them and not another is how an
    // invitation starts promising a week while the stored deadline is a day.
    expect(EMAIL_TOKEN_TTL_HOURS * MS_PER_HOUR).toBe(EMAIL_TOKEN_TTL_MS);
    expect(INVITE_TOKEN_TTL_HOURS * MS_PER_HOUR).toBe(EMAIL_TOKEN_TTL_MS);
  });
});