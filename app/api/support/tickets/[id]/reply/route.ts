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
  MAX_SUPPORT_TICKET_MESSAGE_BODY_LENGTH,
  SupportTicketsStoreUnavailableError,
  getSupportTicketsStore,
  isValidSupportTicketId,
  toPublicSupportTicket,
} from "@/lib/server/support-tickets-store";

// A user's follow-up reply on their own open/needs_user support ticket
// (issue #393). Wallet-signed with purpose "support:ticket-reply", bound to
// the exact ticket id + body so a signed reply can't be replayed against a
// different ticket or a different message.

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
  const replyBody = typeof requestBody?.body === "string" ? requestBody.body.trim() : "";
  const challengeId = typeof requestBody?.challengeId === "string" ? requestBody.challengeId.trim() : "";
  const nonce = typeof requestBody?.nonce === "string" ? requestBody.nonce.trim() : "";
  const signature = typeof requestBody?.signature === "string" ? requestBody.signature.trim() : "";

  if (!replyBody || replyBody.length > MAX_SUPPORT_TICKET_MESSAGE_BODY_LENGTH) {
    return NextResponse.json({ error: `Enter a reply between 1 and ${MAX_SUPPORT_TICKET_MESSAGE_BODY_LENGTH} characters.` }, { status: 400, headers: responseHeaders });
  }
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid support challenge and signature are required." }, { status: 400, headers: responseHeaders });
  }

  const authorisation = await authoriseSupportAction({
    purpose: "support:ticket-reply",
    payload: { ticketId, body: replyBody },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, responseHeaders);

  try {
    const result = await getSupportTicketsStore().addUserMessage(ticketId, authorisation.walletAddress, replyBody);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "That support ticket could not be found." }, { status: 404, headers: responseHeaders });
    }
    if (result.status === "forbidden") {
      return NextResponse.json({ error: "That support ticket does not belong to this wallet." }, { status: 403, headers: responseHeaders });
    }
    if (result.status === "closed") {
      return NextResponse.json({ error: "This ticket is solved or closed and can no longer be replied to." }, { status: 409, headers: responseHeaders });
    }

    // Best-effort and scheduled for after the response, matching the create
    // route (issue #393 review) — a user follow-up is as much a "ticket
    // replied" event as an owner reply, so it gets the same bounded activity
    // kind. Never the reply text.
    runAfterResponse(() =>
      recordAdminActivityBestEffort({
        kind: "ticket-replied",
        serviceKey: "support",
        message: `Wallet ${result.ticket.walletAddress} replied on ticket ${result.ticket.id}.`,
      }),
    );

    return NextResponse.json(
      { ticket: toPublicSupportTicket(result.ticket), message: result.message },
      { status: 201, headers: responseHeaders },
    );
  } catch (error) {
    if (error instanceof SupportTicketsStoreUnavailableError) {
      return NextResponse.json(
        { error: "Support ticket storage is not ready. Apply the latest database migrations and try again." },
        { status: 503, headers: responseHeaders },
      );
    }
    console.error("Support ticket reply failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Your reply could not be sent. Try again." }, { status: 500, headers: responseHeaders });
  }
}
