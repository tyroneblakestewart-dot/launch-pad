import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { ClientErrorStoreUnavailableError, getClientErrorStore } from "@/lib/server/client-errors-store";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

/**
 * Marks a client-error group resolved so it drops out of the default view.
 * Not permanent: if a fresh occurrence lands after this, the store's
 * listGroups will surface the group again automatically.
 */
export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json({ error: "Admin request origin is not allowed." }, { status: 403, headers: NO_STORE_HEADERS });
    }
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const message = typeof body?.message === "string" ? body.message : "";
    const routePath = typeof body?.routePath === "string" ? body.routePath : "";
    if (!message || !routePath) {
      return NextResponse.json({ error: "A message and routePath are required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const result = await getClientErrorStore().resolveGroup(message, routePath);
    if (result === "not_found") {
      return NextResponse.json({ error: "No error group matches that message and route." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    await recordAdminActivityBestEffort({
      kind: "client-error-group-resolved",
      serviceKey: null,
      message: `Client error group resolved: "${message}" on ${routePath}.`,
    });
    return NextResponse.json({}, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof ClientErrorStoreUnavailableError) {
      return NextResponse.json(
        { error: "Client error storage is not ready. Apply the latest database migrations and try again." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    console.error(
      "Admin client-error resolve action failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json({ error: "The action could not be completed. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
