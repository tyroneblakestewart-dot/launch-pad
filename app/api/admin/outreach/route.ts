import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { getOutreachStore, isOutreachStatus, OutreachStoreUnavailableError } from "@/lib/server/outreach-store";
import { isOutreachPostingConfigured } from "@/lib/server/outreach-x-client";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: "The outreach queue is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

/** Read-only admin listing of the outreach queue, optionally filtered by status. */
export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const statusParam = new URL(request.url).searchParams.get("status");
    const status = isOutreachStatus(statusParam) ? statusParam : "all";
    const items = await getOutreachStore().listItems(status);

    return NextResponse.json(
      { items, postingConfigured: isOutreachPostingConfigured() },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof OutreachStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin outreach listing failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json({ error: "The outreach queue could not be loaded. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
