import { NextResponse } from "next/server";
import { isSystemHealthCheckId } from "@/lib/admin-operations";
import {
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "@/lib/server/admin-auth";
import {
  AdminSessionStoreUnavailableError,
  isAdminSessionValid,
} from "@/lib/server/admin-session-store";
import { getVercelOidcToken } from "@/lib/server/ai-responses-runtime";
import { buildServicePipeline } from "@/lib/server/system-health-pipeline";

export const runtime = "nodejs";

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(
    token && (await isAdminSessionValid(hashAdminSessionToken(token))),
  );
}

/**
 * Read-only per-service pipeline drill-down. Fetched on demand when an
 * admin expands a System Health card, not on the 30-second summary poll, so
 * the AI-provider reachability probe below isn't fired every refresh.
 */
export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json(
        { error: "Admin sign-in is required." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const service = new URL(request.url).searchParams.get("service");
    if (!isSystemHealthCheckId(service)) {
      return NextResponse.json(
        { error: "A valid service is required." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const pipeline = await buildServicePipeline(service, {
      requestOidcToken: getVercelOidcToken(request),
    });
    return NextResponse.json(
      { pipeline, checkedAt: new Date().toISOString() },
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
      "Admin health pipeline check failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "The pipeline detail could not be loaded. Try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
