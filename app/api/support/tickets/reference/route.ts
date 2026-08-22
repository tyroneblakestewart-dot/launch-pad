import { NextResponse } from "next/server";
import {
  SUPPORT_REFERENCE_LOOKUP_LIMIT,
  consumeSupportReferenceLookupRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import {
  SupportTicketsStoreUnavailableError,
  getSupportTicketsStore,
  normaliseSupportTicketReferenceCode,
} from "@/lib/server/support-tickets-store";

// Status-only lookup for an anonymous report by its reference code (issue
// #405 review) — no wallet, no signature, read-only. Returns exactly
// { status: "open" | "needs_user" | "solved" | "closed" } — never
// referenceCode, category, createdAt, updatedAt, body, subject, attachment,
// diagnostics, messages, wallet or owner replies. An invalid, missing or
// unknown code all get the identical generic not-found response, so a caller
// can't distinguish "malformed" from "well-formed but nobody filed that
// report" — no oracle for enumeration beyond the already-impractical
// ~8.2e14-value keyspace (31^10 codes).

export const runtime = "nodejs";

function headers(rate: ReturnType<typeof consumeSupportReferenceLookupRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SUPPORT_REFERENCE_LOOKUP_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function notFoundResponse(responseHeaders: Record<string, string>) {
  return NextResponse.json({ error: "No report was found for that reference code." }, { status: 404, headers: responseHeaders });
}

export async function GET(request: Request) {
  const rate = consumeSupportReferenceLookupRateLimit(getClientIp(request));
  const responseHeaders = headers(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many lookups from this network. Try again later." },
      { status: 429, headers: { ...responseHeaders, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("support");
  if (isolationResponse) return isolationResponse;

  const rawCode = new URL(request.url).searchParams.get("code") || "";
  const referenceCode = normaliseSupportTicketReferenceCode(rawCode);
  if (!referenceCode) return notFoundResponse(responseHeaders);

  try {
    const view = await getSupportTicketsStore().lookupAnonymousStatus(referenceCode);
    if (!view) return notFoundResponse(responseHeaders);
    // Exactly one key — { status: "open" } — never referenceCode, category or
    // timestamps (issue #405 review: the caller's own requirement is
    // "status only").
    return NextResponse.json({ status: view.status }, { status: 200, headers: responseHeaders });
  } catch (error) {
    if (error instanceof SupportTicketsStoreUnavailableError) {
      return NextResponse.json(
        { error: "Support ticket storage is not ready. Apply the latest database migrations and try again." },
        { status: 503, headers: responseHeaders },
      );
    }
    console.error("Support ticket reference lookup failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "That lookup could not be completed. Try again." }, { status: 500, headers: responseHeaders });
  }
}
