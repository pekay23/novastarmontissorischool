import { NextResponse, type NextRequest } from "next/server";
import { clientIdentifier, rateLimitAsync } from "@/lib/rate-limit";
import { isLoopbackHttp } from "@/lib/security/transport";
import {
  passwordMatches,
  PREVIEW_COOKIE,
  PREVIEW_DURATION,
  signPreviewSession,
} from "@/.marketing-redesign/access";
import { PREVIEW_ROOT } from "@/.marketing-redesign/content";

function requestOrigin(request: NextRequest): string | null {
  const host =
    request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() ||
    request.headers.get("host")?.trim();
  const protocol =
    request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim()
      .toLowerCase() ||
    request.nextUrl.protocol.replace(/:$/, "").toLowerCase();
  if (!host || (protocol !== "http" && protocol !== "https")) return null;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function returnToPreview(request: NextRequest, query = "") {
  const origin = requestOrigin(request) ?? request.nextUrl.origin;
  const response = NextResponse.redirect(
    new URL(`${PREVIEW_ROOT}/${query}`, origin),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function hasSameRequestOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get("origin");
  const expectedOrigin = requestOrigin(request);

  if (!originHeader || !expectedOrigin) return false;

  try {
    const origin = new URL(originHeader);
    return originHeader === origin.origin && origin.origin === expectedOrigin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) {
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4096) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }
  if (form.get("action") === "lock") {
    const response = returnToPreview(request);
    response.cookies.set(PREVIEW_COOKIE, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
    });
    response.cookies.set("novastar-design-preview", "", {
      path: PREVIEW_ROOT,
      maxAge: 0,
    });
    return response;
  }
  if (form.get("action") !== "unlock") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const budget = await rateLimitAsync(
    `marketing-preview:${clientIdentifier(request)}`,
    10,
    15 * 60 * 1000,
  );
  if (!budget.success) return returnToPreview(request, "?error=limited");
  const configured = process.env.MARKETING_PREVIEW_PASSWORD;
  const candidate = form.get("password");
  if (
    !configured ||
    typeof candidate !== "string" ||
    candidate.length > 256 ||
    !passwordMatches(candidate, configured)
  ) {
    return returnToPreview(request, "?error=password");
  }
  const response = returnToPreview(request, "?previewCheck=1");
  response.cookies.set(PREVIEW_COOKIE, signPreviewSession(configured), {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" && !isLoopbackHttp(request.nextUrl),
    path: "/",
    maxAge: PREVIEW_DURATION,
  });
  return response;
}
