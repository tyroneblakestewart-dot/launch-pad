import { NextResponse } from "next/server";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import {
  ADMIN_SUPPORT_SUGGEST_LIMIT,
  consumeAdminSupportSuggestRateLimit,
  getClientIp,
  isAdminRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { recordTextOperationCostBestEffort, runAfterResponse } from "@/lib/server/ai-operation-cost-store";
import { AI_FEATURE_KEYS } from "@/lib/ai-feature-keys";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { knowledgeEntryId, selectRelevantKnowledge } from "@/lib/server/support-knowledge";
import {
  SupportTicketsStoreUnavailableError,
  getSupportTicketsStore,
  isValidSupportTicketId,
} from "@/lib/server/support-tickets-store";
import {
  buildSuggestionRequestBody,
  checkSuggestionCompliance,
  parseSuggestionResponseDetailed,
  type SupportSuggestion,
} from "@/lib/server/support-suggestion-pipeline";

// Admin-only "Suggest a fix" for a support ticket (issue #400). On-demand
// per ticket, never automatic — each run spends money, so this mirrors
// app/api/social/draft/route.ts's shape (structured output, one corrective
// retry, both responses mechanically re-checked so a bad suggestion can
// never slip through unchecked — the #364 pattern). The suggestion is
// returned to the admin UI only; nothing here writes to the ticket, replies,
// or changes its status. That stays a human action in
// app/api/admin/support/actions/route.ts.

export const runtime = "nodejs";
export const maxDuration = 30;

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

export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json({ error: "Admin request origin is not allowed." }, { status: 403, headers: NO_STORE_HEADERS });
    }
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const rate = consumeAdminSupportSuggestRateLimit(getClientIp(request));
    const rateHeaders = {
      "RateLimit-Limit": String(ADMIN_SUPPORT_SUGGEST_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many suggestion requests. Try again later." },
        { status: 429, headers: { ...NO_STORE_HEADERS, ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const isolationResponse = await getServiceIsolationResponse("support");
    if (isolationResponse) return isolationResponse;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id || !isValidSupportTicketId(id)) {
      return NextResponse.json({ error: "A valid ticket id is required." }, { status: 400, headers: { ...NO_STORE_HEADERS, ...rateHeaders } });
    }

    const ticketOrNull = await getSupportTicketsStore().getById(id);
    if (!ticketOrNull) {
      return NextResponse.json({ error: "That support ticket could not be found." }, { status: 404, headers: { ...NO_STORE_HEADERS, ...rateHeaders } });
    }
    // Narrowed non-null above; capturing it in a const the closures below read
    // (rather than re-reading a mutable binding) keeps that narrowing valid
    // inside requestSuggestion, mirroring the `resolvedAi` pattern below.
    const ticket = ticketOrNull;

    const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
    if (!ai) {
      return NextResponse.json(
        { error: "AI suggestion generation is not configured on this deployment." },
        { status: 503, headers: { ...NO_STORE_HEADERS, ...rateHeaders } },
      );
    }
    const resolvedAi = ai;

    const knowledge = selectRelevantKnowledge({
      category: ticket.category,
      subject: ticket.subject,
      body: ticket.body,
      diagnostics: ticket.diagnostics,
    });
    const knownIds = knowledge.map(knowledgeEntryId);

    type SuggestionAttemptResult = { ok: true; suggestion: SupportSuggestion } | { ok: false; status: number; error: string };

    async function requestSuggestion(correctiveFeedback?: string | null): Promise<SuggestionAttemptResult> {
      let response: Response;
      try {
        response = await fetch(resolvedAi.responsesUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${resolvedAi.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(
            buildSuggestionRequestBody(
              {
                ticket: { category: ticket.category, subject: ticket.subject, body: ticket.body, diagnostics: ticket.diagnostics },
                knowledge,
                attachmentDataUrl: ticket.attachmentDataUrl,
                correctiveFeedback,
              },
              resolvedAi.model,
            ),
          ),
          signal: AbortSignal.timeout(25_000),
        });
      } catch (error) {
        console.error("Support suggestion request failed before receiving a response", error instanceof Error ? error.message : error);
        return { ok: false, status: 502, error: "The suggestion request could not reach the AI provider. Try again." };
      }

      if (!response.ok) {
        const message = await response.text().catch(() => "");
        console.error("Support suggestion request failed", response.status, message.slice(0, 500));
        return { ok: false, status: 502, error: "The suggestion request failed. Try again." };
      }

      let payload: OpenAIResponse;
      try {
        payload = (await response.json()) as OpenAIResponse;
      } catch {
        return { ok: false, status: 502, error: "The AI returned an invalid response." };
      }

      runAfterResponse(() =>
        recordTextOperationCostBestEffort({
          featureKey: correctiveFeedback ? AI_FEATURE_KEYS.SUPPORT_SUGGESTION_RETRY : AI_FEATURE_KEYS.SUPPORT_SUGGESTION,
          walletAddress: null,
          accessSource: "unknown",
          provider: resolvedAi.source,
          response: payload,
          fallbackModel: resolvedAi.model,
        }),
      );

      const parsed = parseSuggestionResponseDetailed(payload);
      if (!parsed.ok) {
        console.error("Support suggestion parse failed", parsed);
        return { ok: false, status: 502, error: "The AI response didn't match the expected format. Try again." };
      }
      return { ok: true, suggestion: parsed.suggestion };
    }

    const result = await requestSuggestion();
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status, headers: { ...NO_STORE_HEADERS, ...rateHeaders } });
    }

    const compliance = checkSuggestionCompliance(result.suggestion, knownIds);
    if (!compliance.violated) {
      await recordAdminActivityBestEffort({
        kind: "support-suggestion-generated",
        serviceKey: "support",
        message: `Generated a fix suggestion for ticket ${ticket.id}.`,
      });
      return NextResponse.json({ suggestion: result.suggestion }, { headers: { ...NO_STORE_HEADERS, ...rateHeaders } });
    }

    const retryResult = await requestSuggestion(compliance.feedback);
    if (!retryResult.ok) {
      console.error("Corrective retry request failed after the first suggestion failed compliance checks", retryResult.error);
      return NextResponse.json(
        { error: "The AI suggestion failed a safety check, and the automatic retry could not produce a compliant replacement. Try again." },
        { status: 502, headers: { ...NO_STORE_HEADERS, ...rateHeaders } },
      );
    }

    const retryCompliance = checkSuggestionCompliance(retryResult.suggestion, knownIds);
    if (retryCompliance.violated) {
      console.error("Suggestion still failed compliance checks after the corrective retry", retryCompliance.feedback);
      return NextResponse.json(
        { error: "The AI couldn't generate a suggestion that passed our checks. Try again." },
        { status: 502, headers: { ...NO_STORE_HEADERS, ...rateHeaders } },
      );
    }

    await recordAdminActivityBestEffort({
      kind: "support-suggestion-generated",
      serviceKey: "support",
      message: `Generated a fix suggestion for ticket ${ticket.id} (after one corrective retry).`,
    });
    return NextResponse.json({ suggestion: retryResult.suggestion }, { headers: { ...NO_STORE_HEADERS, ...rateHeaders } });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof SupportTicketsStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Admin support suggestion failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "The suggestion could not be generated. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
