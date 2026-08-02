import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import {
  ADMIN_SESSION_COOKIE,
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "@/lib/server/admin-auth";
import {
  AdminSessionStoreUnavailableError,
  destroyAdminSession,
} from "@/lib/server/admin-session-store";

export const runtime = "nodejs";

function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function POST(request: Request) {
  if (!isAdminRequestOriginAllowed(request)) {
    return NextResponse.json(
      { error: "Admin logout origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  let status = 200;
  let errorMessage: string | null = null;

  if (token) {
    try {
      await destroyAdminSession(hashAdminSessionToken(token));
    } catch (error) {
      status = error instanceof AdminSessionStoreUnavailableError ? 503 : 500;
      errorMessage =
        status === 503
          ? "Admin session storage is not configured."
          : "Admin logout failed unexpectedly.";
      if (status === 500) {
        console.error(
          "Admin logout failed unexpectedly.",
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
      }
    }
  }

  const response = NextResponse.json(
    errorMessage
      ? { authenticated: false, error: errorMessage }
      : { authenticated: false },
    { status, headers: { "Cache-Control": "no-store" } },
  );
  clearSessionCookie(response);
  return response;
}
