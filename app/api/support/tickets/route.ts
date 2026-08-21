import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  SUPPORT_ACTION_LIMIT,
  SUPPORT_READ_LIMIT,
  consumeSupportActionRateLimit,
  consumeSupportReadRateLimit,
  getClientIp,
  isSupportRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { runAfterResponse } from "@/lib/server/ai-operation-cost-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { sendSupportTicketTelegramAlertBestEffort } from "@/lib/server/support-ticket-alert";
import { buildSupportTicketDiagnostics } from "@/lib/server/support-ticket-diagnostics";
import { authoriseSupportAction, type AuthoriseSupportActionResult } from "@/lib/server/support-ticket-auth";
import {
  MAX_SUPPORT_TICKET_BODY_LENGTH,
  MAX_SUPPORT_TICKET_SUBJECT_LENGTH,
  SupportTicketsStoreUnavailableError,
  getSupportTicketsStore,
  isSupportTicketCategory,
  toPublicSupportTicket,
} from "@/lib/server/support-tickets-store";

// User-facing support ticket create + list (issue #393). Creation is
// wallet-signed (purpose "support:ticket-create"); listing is a plain GET
// keyed by walletAddress query parameter, following the documented
// GET /api/social/connections pattern (no wallet signature required to
// read your own already-public-to-you ticket history).

export const runtime = "nodejs";

function actionHeaders(rate: ReturnType<typeof consumeSupportActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SUPPORT_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function readHeaders(rate: ReturnType<typeof consumeSupportReadRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SUPPORT_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(result: Exclude<AuthoriseSupportActionResult, { status: "ok" }>, headers: Record<string, string>) {
  if (result.status === "expired") return NextResponse.json({ error: "The support challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That support challenge has already been used." }, { status: 409, headers });
  return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers });
}

function storageUnavailableResponse(headers: Record<string, string>) {
  return NextResponse.json(
    { error: "Support ticket storage is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers },
  );
}

export async function GET(request: Request) {
  const rate = consumeSupportReadRateLimit(getClientIp(request));
  const headers = readHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("support");
  if (isolationResponse) return isolationResponse;

  const walletAddress = new URL(request.url).searchParams.get("walletAddress") || "";
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers });
  }

  try {
    const tickets = await getSupportTicketsStore().listForWallet(walletAddress);
    return NextResponse.json({ tickets: tickets.map(toPublicSupportTicket) }, { status: 200, headers });
  } catch (error) {
    if (error instanceof SupportTicketsStoreUnavailableError) return storageUnavailableResponse(headers);
    console.error("Support ticket listing failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Your support tickets could not be loaded. Try again." }, { status: 500, headers });
  }
}

export async function POST(request: Request) {
  if (!isSupportRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Support request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeSupportActionRateLimit(getClientIp(request));
  const headers = actionHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("support");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const category = body?.category;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const ticketBody = typeof body?.body === "string" ? body.body.trim() : "";
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";

  if (!isSupportTicketCategory(category)) {
    return NextResponse.json({ error: "A valid category is required." }, { status: 400, headers });
  }
  if (!subject || subject.length > MAX_SUPPORT_TICKET_SUBJECT_LENGTH) {
    return NextResponse.json({ error: `Enter a subject between 1 and ${MAX_SUPPORT_TICKET_SUBJECT_LENGTH} characters.` }, { status: 400, headers });
  }
  if (!ticketBody || ticketBody.length > MAX_SUPPORT_TICKET_BODY_LENGTH) {
    return NextResponse.json({ error: `Enter a description between 1 and ${MAX_SUPPORT_TICKET_BODY_LENGTH} characters.` }, { status: 400, headers });
  }
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid support challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSupportAction({
    purpose: "support:ticket-create",
    payload: { category, subject, body: ticketBody },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  try {
    const diagnostics = await buildSupportTicketDiagnostics(authorisation.walletAddress);
    const ticket = await getSupportTicketsStore().create({
      walletAddress: authorisation.walletAddress,
      category,
      subject,
      body: ticketBody,
      diagnostics,
    });

    // Both are strictly best-effort and must never delay the response — a
    // pending Telegram call previously stayed on the request's critical path
    // (issue #393 review) even though it was never awaited into the
    // success/failure decision. runAfterResponse schedules them for after the
    // response has already been sent, matching the recordAiOperationCostBestEffort
    // pattern used by every other best-effort post-write bookkeeping call.
    runAfterResponse(() =>
      recordAdminActivityBestEffort({
        kind: "ticket-created",
        serviceKey: "support",
        message: `Wallet ${ticket.walletAddress} opened a ${ticket.category} ticket (${ticket.id}).`,
      }),
    );
    runAfterResponse(() => sendSupportTicketTelegramAlertBestEffort(ticket));

    return NextResponse.json({ ticket: toPublicSupportTicket(ticket) }, { status: 201, headers });
  } catch (error) {
    if (error instanceof SupportTicketsStoreUnavailableError) return storageUnavailableResponse(headers);
    console.error("Support ticket creation failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Your support ticket could not be submitted. Try again." }, { status: 500, headers });
  }
}
