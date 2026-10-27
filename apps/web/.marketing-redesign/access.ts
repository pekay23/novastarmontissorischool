import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";

export const PREVIEW_COOKIE = "novastar-design-preview-v2";
export const PREVIEW_DURATION = 8 * 60 * 60;

export function passwordMatches(candidate: string, password: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(password).digest(),
  );
}

export function signPreviewSession(
  password: string,
  expires = Date.now() + PREVIEW_DURATION * 1000,
): string {
  const payload = String(expires);
  return `${payload}.${createHmac("sha256", password).update(`novastar-preview:${payload}`).digest("hex")}`;
}

export function validPreviewSession(
  token: string,
  password: string,
  now = Date.now(),
): boolean {
  const [expires, signature, extra] = token.split(".");
  if (
    extra !== undefined ||
    !expires ||
    !signature ||
    !/^[0-9a-f]{64}$/.test(signature) ||
    !/^\d{13}$/.test(expires)
  )
    return false;
  const deadline = Number(expires);
  if (deadline <= now || deadline > now + PREVIEW_DURATION * 1000) return false;
  return passwordMatches(token, signPreviewSession(password, deadline));
}

export async function hasPreviewAccess(): Promise<boolean> {
  const password = process.env.MARKETING_PREVIEW_PASSWORD;
  if (!password) return false;

  // The cookies API collapses duplicate names; an old cookie at another path
  // must not mask the valid signed session sent alongside it.
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const prefix = `${PREVIEW_COOKIE}=`;
  return cookieHeader.split(";").some((entry) => {
    const cookie = entry.trim();
    return (
      cookie.startsWith(prefix) &&
      validPreviewSession(cookie.slice(prefix.length), password)
    );
  });
}
