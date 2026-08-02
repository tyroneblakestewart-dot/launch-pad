import { NextResponse } from "next/server";
import {
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "@/lib/server/admin-auth";
import {
  AdminSessionStoreUnavailableError,
  isAdminSessionValid,
} from "@/lib/server/admin-session-store";
import { getSystemHealth } from "@/lib/server/system-health";

export const runtime = "nodejs";

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(
    token && (await isAdminSessionValid(hashAdminSessionToken(token))),
  );
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const checks = await getSystemHealth();
    return NextResponse.json(
      { checks, checkedAt: new Date().toISOString() },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError) {
      return NextResponse.json(
        {
          error:
            "Admin session storage is not configured. Apply the database migrations and try again.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    console.error(
      "Admin health check failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "Admin health check failed unexpectedly. Try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
