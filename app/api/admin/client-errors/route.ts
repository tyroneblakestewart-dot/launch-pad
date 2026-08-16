import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { getClientErrorStore } from "@/lib/server/client-errors-store";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

/** Read-only view: unresolved client-error groups, most frequent then most recent first. */
export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const snapshot = await getClientErrorStore().listGroups();
    return NextResponse.json(snapshot, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError) {
      return NextResponse.json(
        { error: "Admin session storage is not configured. Apply the database migrations and try again." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    console.error(
      "Admin client-error listing failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "Client error data could not be loaded. Try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
