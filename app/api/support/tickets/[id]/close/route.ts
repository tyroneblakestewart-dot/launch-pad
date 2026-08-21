import { NextResponse } from "next/server";
import {
  SUPPORT_ACTION_LIMIT,
  consumeSupportActionRateLimit,
  getClientIp,
  isSupportRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { runAfterResponse } from "@/lib/server/ai-operation-cost-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSupportAction, type AuthoriseSupportActionResult } from "@/lib/server/support-ticket-auth";
import {
  SupportTicketsStoreUnavailableError,
  getSupportTicketsStore,
  isValidSupportTicketId,
  toPublicSupportTicket,
} from "@/lib/server/support-tickets-store";

// A user closing their own open/needs_user support ticket (issue #401).
// Wallet-signed with purpose "support:ticket-close", bound to the exact
// ticket id — the same challenge/signature primitives as
// support:ticket-reply, just without a body. Reopening is out of scope: the
// owner can already see everything from /admin, and a user can always file a
// fresh report.

export const runtime = "nodejs";

function headers(rate: ReturnType<typeof consumeSupportActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SUPPORT_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(result: Exclude<AuthoriseSupportActionResult, { status: "ok" }>, responseHeaders: Record<string, string>) {
  if (result.status === "expired") return NextResponse.json({ error: "The support challenge expired. Try again." }, { status: 410, headers: responseHeaders });
  if (result.status === "replayed") return NextResponse.json({ error: "That support challenge has already been used." }, { status: 409, headers: responseHeaders });
  return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers: responseHeaders });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupportRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Support request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeSupportActionRateLimit(getClientIp(request));
  const responseHeaders = headers(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...responseHeaders, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("support");
  if (isolationResponse) return isolationResponse;

  const ticketId = (await params).id?.trim() || "";
  if (!isValidSupportTicketId(ticketId)) {
    return NextResponse.json({ error: "A valid ticket id is required." }, { status: 400, headers: responseHeaders });
  }

  const requestBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const challengeId = typeof requestBody?.challengeId === "string" ? requestBody.challengeId.trim() : "";
  const nonce = typeof requestBody?.nonce === "string" ? requestBody.nonce.trim() : "";
  const signature = typeof requestBody?.signature === "string" ? requestBody.signature.trim() : "";

  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid support challenge and signature are required." }, { status: 400, headers: responseHeaders });
  }

  const authorisation = await authoriseSupportAction({
    purpose: "support:ticket-close",
    payload: { ticketId },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, responseHeaders);

  try {
    const result = await getSupportTicketsStore().closeTicketByUser(ticketId, authorisation.walletAddress);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "That support ticket could not be found." }, { status: 404, headers: responseHeaders });
    }
    if (result.status === "forbidden") {
      return NextResponse.json({ error: "That support ticket does not belong to this wallet." }, { status: 403, headers: responseHeaders });
    }
    if (result.status === "closed") {
      return NextResponse.json({ error: "This ticket is already solved or closed." }, { status: 409, headers: responseHeaders });
    }

    // Best-effort and scheduled for after the response, matching
    // ticket-created/ticket-replied — never the ticket subject/body, only
    // the ticket id and wallet.
    runAfterResponse(() =>
      recordAdminActivityBestEffort({
        kind: "ticket-closed-by-user",
        serviceKey: "support",
        message: `Wallet ${result.ticket.walletAddress} closed ticket ${result.ticket.id}.`,
      }),
    );

    return NextResponse.json({ ticket: toPublicSupportTicket(result.ticket) }, { status: 200, headers: responseHeaders });
  } catch (error) {
    if (error instanceof SupportTicketsStoreUnavailableError) {
      return NextResponse.json(
        { error: "Support ticket storage is not ready. Apply the latest database migrations and try again." },
        { status: 503, headers: responseHeaders },
      );
    }
    console.error("Support ticket close failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Your report could not be closed. Try again." }, { status: 500, headers: responseHeaders });
  }
}
