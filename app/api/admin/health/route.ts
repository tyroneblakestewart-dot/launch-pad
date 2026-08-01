import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { isAdminSessionValid } from "@/lib/server/admin-session-store";
import { getSystemHealth } from "@/lib/server/system-health";

export const runtime = "nodejs";

function isAuthenticated(request: Request): boolean {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && isAdminSessionValid(hashAdminSessionToken(token)));
}

export async function GET(request: Request) {
  if (!isAuthenticated(request)) {
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
}
