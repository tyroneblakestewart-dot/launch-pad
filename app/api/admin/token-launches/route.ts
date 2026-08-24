import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { getTokenLaunchesStore, TokenLaunchesStoreUnavailableError } from "@/lib/server/token-launches-store";

// Read-only admin listing of recorded token launches (Milestone A, issue
// #409, rule 10). Mirrors app/api/admin/support/route.ts's auth/error-mapping
// pattern.

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: "Token launch storage is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const launches = await getTokenLaunchesStore().listForAdmin();
    return NextResponse.json({ launches }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof TokenLaunchesStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Admin token launch listing failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Token launches could not be loaded. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
