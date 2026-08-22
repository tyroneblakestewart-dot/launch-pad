import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import {
  MAX_SUPPORT_TICKET_MESSAGE_BODY_LENGTH,
  SupportTicketsStoreUnavailableError,
  getSupportTicketsStore,
  isValidSupportTicketId,
} from "@/lib/server/support-tickets-store";

// Owner reply + status controls for the /admin Support section (issue
// #393). Every mutation enforces the existing allowed-Origin check on top
// of admin session auth, and returns no-store responses, following
// app/api/admin/outreach/actions/route.ts's pattern. "reply" creates an
// owner message and flips the ticket to needs_user (enforced inside the
// store, not here — see addOwnerMessage). "status" only accepts solved or
// closed — open/needs_user are system-driven (creation / a reply), not a
// manual admin toggle.

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const ACTIONS = ["reply", "status"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

const CLOSABLE_STATUSES = ["solved", "closed"] as const;
type ClosableStatus = (typeof CLOSABLE_STATUSES)[number];

function isClosableStatus(value: unknown): value is ClosableStatus {
  return typeof value === "string" && (CLOSABLE_STATUSES as readonly string[]).includes(value);
}

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

export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json({ error: "Admin request origin is not allowed." }, { status: 403, headers: NO_STORE_HEADERS });
    }
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const action = body?.action;
    if (!id || !isAction(action)) {
      return NextResponse.json({ error: "A valid ticket id and action are required." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (!isValidSupportTicketId(id)) {
      return NextResponse.json({ error: "A valid ticket id is required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (action === "reply") {
      const replyBody = typeof body?.body === "string" ? body.body.trim() : "";
      if (!replyBody || replyBody.length > MAX_SUPPORT_TICKET_MESSAGE_BODY_LENGTH) {
        return NextResponse.json(
          { error: `Enter a reply between 1 and ${MAX_SUPPORT_TICKET_MESSAGE_BODY_LENGTH} characters.` },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      const result = await getSupportTicketsStore().addOwnerMessage(id, replyBody);
      if (result.status === "not_found") {
        return NextResponse.json({ error: "That support ticket could not be found." }, { status: 404, headers: NO_STORE_HEADERS });
      }
      if (result.status === "anonymous") {
        return NextResponse.json(
          { error: "This is an anonymous report — it has no wallet to reply to. Use the status controls instead." },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      if (result.status === "closed") {
        return NextResponse.json(
          { error: "This ticket is solved or closed and can no longer be replied to." },
          { status: 409, headers: NO_STORE_HEADERS },
        );
      }
      await recordAdminActivityBestEffort({
        kind: "ticket-replied",
        serviceKey: "support",
        message: `Owner replied on ticket ${result.ticket.id}.`,
      });
      return NextResponse.json({ ticket: result.ticket, message: result.message }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // action === "status"
    const status = body?.status;
    if (!isClosableStatus(status)) {
      return NextResponse.json({ error: "Status must be 'solved' or 'closed'." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const result = await getSupportTicketsStore().setStatus(id, status);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "That support ticket could not be found." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({ ticket: result.ticket }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof SupportTicketsStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Admin support ticket action failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "The action could not be completed. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
