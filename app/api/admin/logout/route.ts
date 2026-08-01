import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import {
  ADMIN_SESSION_COOKIE,
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "@/lib/server/admin-auth";
import { destroyAdminSession } from "@/lib/server/admin-session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json(
        { error: "Admin logout origin is not allowed." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const token = parseAdminSessionCookie(request.headers.get("cookie"));
    if (token) destroyAdminSession(hashAdminSessionToken(token));

    const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    console.error("Admin logout failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json(
      { error: "Admin logout failed unexpectedly. Try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
