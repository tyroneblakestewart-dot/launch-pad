import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import {
  getSupportTicketsStore,
  isSupportTicketStatus,
  SupportTicketsStoreUnavailableError,
  type SupportTicketStatus,
} from "@/lib/server/support-tickets-store";

// Read-only admin listing of the support ticket queue, optionally filtered
// by status. Mirrors app/api/admin/outreach/route.ts's auth/error-mapping
// pattern. Diagnostics and the full message history are returned in full —
// this is an authenticated admin-only view of data the owner needs to
// actually help the reporting wallet.

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: "Support ticket storage is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const statusParam = new URL(request.url).searchParams.get("status");
    let status: SupportTicketStatus | "all" = "all";
    if (statusParam !== null && statusParam !== "all") {
      if (!isSupportTicketStatus(statusParam)) {
        return NextResponse.json(
          { error: "Status must be 'all' or one of the known ticket statuses." },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      status = statusParam;
    }
    const tickets = await getSupportTicketsStore().listForAdmin(status);

    return NextResponse.json({ tickets }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof SupportTicketsStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Admin support ticket listing failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "The support queue could not be loaded. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
