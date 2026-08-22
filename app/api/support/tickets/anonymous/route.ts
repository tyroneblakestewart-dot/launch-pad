import { NextResponse } from "next/server";
import {
  SUPPORT_ANONYMOUS_CREATE_LIMIT,
  consumeSupportAnonymousCreateRateLimit,
  getClientIp,
  isSupportRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { runAfterResponse } from "@/lib/server/ai-operation-cost-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { sendSupportTicketTelegramAlertBestEffort } from "@/lib/server/support-ticket-alert";
import {
  supportTicketAttachmentErrorMessage,
  validateSupportTicketAttachment,
} from "@/lib/server/support-ticket-attachment";
import {
  MAX_SUPPORT_TICKET_BODY_LENGTH,
  MAX_SUPPORT_TICKET_SUBJECT_LENGTH,
  SupportTicketsStoreUnavailableError,
  getSupportTicketsStore,
  isSupportTicketCategory,
  toPublicSupportTicket,
} from "@/lib/server/support-tickets-store";

// Anonymous/no-wallet support reporting (issue #405) — a fallback for a
// reporter whose wallet won't connect. Deliberately a separate route from
// the signed POST /api/support/tickets rather than a mode flag on it, so
// the signed path's auth pipeline and semantics stay completely untouched.
// No wallet signature or challenge is accepted or required here at all.
// Diagnostics stay minimal (no plan/social-connection lookup — there's no
// wallet to check either against) and the response returns the
// server-generated reference code exactly once, on success.

export const runtime = "nodejs";

function headers(rate: ReturnType<typeof consumeSupportAnonymousCreateRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SUPPORT_ANONYMOUS_CREATE_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function storageUnavailableResponse(responseHeaders: Record<string, string>) {
  return NextResponse.json(
    { error: "Support ticket storage is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers: responseHeaders },
  );
}

export async function POST(request: Request) {
  if (!isSupportRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Support request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const rate = consumeSupportAnonymousCreateRateLimit(getClientIp(request));
  const responseHeaders = headers(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many anonymous reports from this network. Try again later, or connect a wallet." },
      { status: 429, headers: { ...responseHeaders, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("support");
  if (isolationResponse) return isolationResponse;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const category = body?.category;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const ticketBody = typeof body?.body === "string" ? body.body.trim() : "";

  if (!isSupportTicketCategory(category)) {
    return NextResponse.json({ error: "A valid category is required." }, { status: 400, headers: responseHeaders });
  }
  if (!subject || subject.length > MAX_SUPPORT_TICKET_SUBJECT_LENGTH) {
    return NextResponse.json(
      { error: `Enter a subject between 1 and ${MAX_SUPPORT_TICKET_SUBJECT_LENGTH} characters.` },
      { status: 400, headers: responseHeaders },
    );
  }
  if (!ticketBody || ticketBody.length > MAX_SUPPORT_TICKET_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Enter a description between 1 and ${MAX_SUPPORT_TICKET_BODY_LENGTH} characters.` },
      { status: 400, headers: responseHeaders },
    );
  }

  // Attachment validation is server-authoritative, identical to the signed
  // path — no wallet-signature binding exists here to check it against,
  // since there is no signature at all in the anonymous flow.
  const attachmentValidation = validateSupportTicketAttachment(body?.attachmentDataUrl);
  if (attachmentValidation.status !== "ok" && attachmentValidation.status !== "empty") {
    return NextResponse.json({ error: supportTicketAttachmentErrorMessage(attachmentValidation.status) }, { status: 400, headers: responseHeaders });
  }
  const attachmentDataUrl = attachmentValidation.status === "ok" ? attachmentValidation.dataUrl : null;

  try {
    // Deliberately minimal — never a plan/subscription or social-connection
    // lookup, since there's no wallet to check either against (issue #405).
    const diagnostics = { mode: "anonymous" as const };
    const ticket = await getSupportTicketsStore().createAnonymous({
      category,
      subject,
      body: ticketBody,
      diagnostics,
      attachmentDataUrl,
    });

    runAfterResponse(() =>
      recordAdminActivityBestEffort({
        kind: "ticket-created",
        serviceKey: "support",
        message: `An anonymous ${ticket.category} report was opened (ref ${ticket.referenceCode}).`,
      }),
    );
    runAfterResponse(() => sendSupportTicketTelegramAlertBestEffort(ticket));

    return NextResponse.json({ ticket: toPublicSupportTicket(ticket) }, { status: 201, headers: responseHeaders });
  } catch (error) {
    if (error instanceof SupportTicketsStoreUnavailableError) return storageUnavailableResponse(responseHeaders);
    console.error("Anonymous support ticket creation failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "Your report could not be submitted. Try again." }, { status: 500, headers: responseHeaders });
  }
}
