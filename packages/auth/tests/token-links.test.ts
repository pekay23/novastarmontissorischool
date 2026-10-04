/**
 * The setup link: where the token is allowed to appear, and where it is not.
 *
 * `emailActionUrl` is the last thing between a minted token and a mailbox, and it is
 * the only place the raw value is ever written down. Two properties keep that safe.
 * The token is confined to a single query parameter, so it cannot become a second
 * parameter, a fragment or a path segment -- and because it is in the query rather
 * than the path, a server log that records only the path holds nothing usable. And
 * nothing the token helpers produce carries a second copy of the token, so a
 * transcript of this module's output contains exactly one live credential, and it is
 * the link.
 *
 * Nothing in this file touches a database.
 */
import { describe, expect, test } from "bun:test";
import { emailActionUrl, hashEmailToken, inviteActionUrl, isEmailToken, mintEmailToken } from "../invite";

const ORIGIN = "https://portal.novastar.test";
const PATH = "set-password";

/** How many times `needle` appears in `haystack`. */
const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** The token as it comes back out of a parsed link, exactly as a recipient gets it. */
const tokenFrom = (url: string): string => new URL(url).searchParams.get("token") ?? "";

// ---------------------------------------------------------------------------

describe("the link carries the token once, in the one place it belongs", () => {
  test("a token cannot add a second query parameter to a setup link", () => {
    // The builder percent-encodes, so a token that looks like it is smuggling a
    // second parameter is carried whole instead. Without the encoding this token
    // would arrive as `token=vem_a` plus a `role` the recipient's browser then treats
    // as part of the request.
    const forged = "vem_a&role=HEADMASTER";
    const parsed = new URL(emailActionUrl(ORIGIN, PATH, forged));
    expect([...parsed.searchParams.keys()]).toEqual(["token"]);
    expect(parsed.searchParams.has("role")).toBe(false);
    expect(parsed.searchParams.get("token")).toBe(forged);
  });

  test("a token cannot terminate the query and start a fragment", () => {
    const forged = "vem_a#pwn";
    const parsed = new URL(emailActionUrl(ORIGIN, PATH, forged));
    expect(parsed.hash).toBe("");
    expect(parsed.searchParams.get("token")).toBe(forged);
  });

  test("a token containing a space or a non-ASCII character is encoded, never dropped", () => {
    for (const forged of ["vem_a b", "vem_é", "vem_a\nb"]) {
      const parsed = new URL(emailActionUrl(ORIGIN, PATH, forged));
      expect(parsed.searchParams.get("token")).toBe(forged);
    }
  });

  test("the token survives the round trip byte-identically, so the link that is emailed is the link that works", () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = mintEmailToken();
      const recovered = tokenFrom(emailActionUrl(ORIGIN, PATH, token));
      expect(recovered).toBe(token);
      expect(isEmailToken(recovered)).toBe(true);
    }
  });

  test("a path-only log line holds no credential, because the token is in the query", () => {
    // Access logs, `Referer` prefixes and path-only error reports all stop at the
    // `?`. Moving the token into the path would put a live credential in every one of
    // them, and every copy of it would be a second working link.
    const token = mintEmailToken();
    const pathOnly = inviteActionUrl(ORIGIN, token).split("?")[0] ?? "";
    expect(pathOnly).toContain("/set-password");
    expect(pathOnly).not.toContain("token");
    expect(occurrences(pathOnly, token)).toBe(0);
  });

  test("two links differ only in the token, so nothing unpredictable is hiding in the origin or the path", () => {
    const first = mintEmailToken();
    const second = mintEmailToken();
    expect(first).not.toBe(second);
    const shell = (link: string, token: string): string => link.replace(token, "[token]");
    expect(shell(inviteActionUrl(ORIGIN, first), first)).toBe(
      shell(inviteActionUrl(ORIGIN, second), second),
    );
  });
});

// ---------------------------------------------------------------------------

describe("the invite link is the set-password journey's link", () => {
  test("the path is the portal's set-password route, whatever the origin looks like", () => {
    for (const origin of [ORIGIN, `${ORIGIN}/`]) {
      const parsed = new URL(inviteActionUrl(origin, mintEmailToken()));
      expect(parsed.origin).toBe(ORIGIN);
      expect(parsed.pathname).toBe("/set-password");
      expect([...parsed.searchParams.keys()]).toEqual(["token"]);
    }
  });

  test("the token appears once, in the query, and nowhere else in the link", () => {
    const token = mintEmailToken();
    const url = inviteActionUrl(ORIGIN, token);
    expect(occurrences(url, token)).toBe(1);
    expect(url.split("?")[0] ?? "").not.toContain("vem_");
  });
});

describe("one slash joins the origin and the path", () => {
  test.each([
    ["neither carries a slash", ORIGIN, PATH],
    ["the origin carries a trailing slash", `${ORIGIN}/`, PATH],
    ["the path carries a leading slash", ORIGIN, `/${PATH}`],
    ["both carry one", `${ORIGIN}/`, `/${PATH}`],
  ])("%s", (_label, origin, path) => {
    // A doubled slash still routes on most servers, but it changes the URL the
    // recipient sees and the one a support agent reads back off a screenshot.
    const url = emailActionUrl(origin, path, mintEmailToken());
    expect(url.startsWith(`${ORIGIN}/${PATH}?token=`)).toBe(true);
    const afterScheme = url.slice("https://".length);
    expect(occurrences(afterScheme, "//")).toBe(0);
    expect(occurrences(afterScheme, "?")).toBe(1);
    expect(afterScheme).not.toContain("#");
  });
});

// ---------------------------------------------------------------------------

describe("nothing this module returns carries a second copy of the token", () => {
  /** Every string a caller can hold once a token has been minted. */
  function outputs(token: string): Record<string, string> {
    return {
      token,
      digest: hashEmailToken(token),
      link: emailActionUrl(ORIGIN, PATH, token),
      invite: inviteActionUrl(ORIGIN, token),
    };
  }

  test("the digest is the only output with no copy of the raw token in it", () => {
    const token = mintEmailToken();
    for (const [name, value] of Object.entries(outputs(token))) {
      expect({ name, copies: occurrences(value, token) }).toEqual({
        name,
        copies: name === "digest" ? 0 : 1,
      });
    }
  });

  test("the token prefix appears in the link and nowhere else", () => {
    // Not just this run's token: any `vem_` in a digest, a message or a log line is a
    // mintable-shaped string, which is the shape an operator or a scanner looks for.
    for (const [name, value] of Object.entries(outputs(mintEmailToken()))) {
      expect({ name, carriesPrefix: occurrences(value, "vem_") > 0 }).toEqual({
        name,
        carriesPrefix: name !== "digest",
      });
    }
  });

  test("the digest never appears in a link, so the stored form cannot be pasted into one", () => {
    const token = mintEmailToken();
    const digest = hashEmailToken(token);
    for (const value of [emailActionUrl(ORIGIN, PATH, token), inviteActionUrl(ORIGIN, token)]) {
      expect(occurrences(value, digest)).toBe(0);
      expect(tokenFrom(value)).toBe(token);
    }
  });
});