import { NextResponse } from "next/server";
import {
  SOCIAL_DRAFT_LIMIT,
  consumeSocialDraftRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import { normaliseLikedSampleLines } from "@/lib/server/social-reinforcement";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import {
  buildDraftRequestBody,
  checkDraftAngleCompliance,
  parseDraftResponseDetailed,
  type DraftProject,
} from "@/lib/server/social-draft-pipeline";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";
import type { SocialDraft, VoiceProfile } from "@/lib/social-studio-types";

export const runtime = "nodejs";
export const maxDuration = 30;

type DraftRequestBody = {
  walletAddress?: unknown;
  project?: {
    name?: unknown;
    ticker?: unknown;
    description?: unknown;
    chain?: unknown;
    contractAddress?: unknown;
  };
  voiceProfile?: unknown;
  dayLabel?: unknown;
  theme?: unknown;
  likedSampleLines?: unknown;
  directionBrief?: unknown;
  voiceExamples?: unknown;
  recentDrafts?: unknown;
  angleIndex?: unknown;
};

const MAX_VOICE_EXAMPLES_ACCEPTED = 20;
const MAX_RECENT_DRAFTS_ACCEPTED = 5;

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function isVoiceProfile(value: unknown): value is VoiceProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.tone === "string" &&
    typeof candidate.vocabulary === "string" &&
    typeof candidate.cadence === "string" &&
    typeof candidate.emojiHabits === "string" &&
    Array.isArray(candidate.sampleLines)
  );
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin = process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return NextResponse.json(
      { error: "AI Social Studio access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
      return NextResponse.json({ error: "Unauthorised draft request." }, { status: 401, headers: noStoreHeaders() });
    }
    const rate = consumeSocialDraftRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(SOCIAL_DRAFT_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Draft-generation rate limit exceeded. Try again later." },
        { status: 429, headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }) },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  let body: DraftRequestBody;
  try {
    body = (await request.json()) as DraftRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  const authorisation = await authoriseSocialStudioRequest(body.walletAddress);
  if (authorisation.status === "invalid-wallet") {
    return NextResponse.json({ error: authorisation.message }, { status: 401, headers: noStoreHeaders(rateHeaders) });
  }
  if (authorisation.status === "unavailable") {
    return NextResponse.json({ error: authorisation.message }, { status: 503, headers: noStoreHeaders(rateHeaders) });
  }
  if (authorisation.status === "upsell") {
    return NextResponse.json(
      { error: authorisation.message, code: "social-studio-plan-required", upsell: true },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const name = typeof body.project?.name === "string" ? body.project.name.trim() : "";
  const ticker = typeof body.project?.ticker === "string" ? body.project.ticker.trim() : "";
  const chain = body.project?.chain === "robinhood" ? "robinhood" : "solana";
  if (!name || !ticker) {
    return NextResponse.json({ error: "A project name and ticker are required." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  const project: DraftProject = {
    name,
    ticker,
    description: typeof body.project?.description === "string" ? body.project.description.slice(0, 2000) : "",
    chain,
    contractAddress: typeof body.project?.contractAddress === "string" ? body.project.contractAddress.slice(0, 200) : "",
  };
  const voiceProfile = isVoiceProfile(body.voiceProfile) ? body.voiceProfile : null;
  const dayLabel = typeof body.dayLabel === "string" ? body.dayLabel.slice(0, 60) : null;
  const theme = typeof body.theme === "string" ? body.theme.slice(0, 200) : null;
  const likedSampleLines = normaliseLikedSampleLines(body.likedSampleLines);
  const directionBrief = typeof body.directionBrief === "string" ? body.directionBrief.slice(0, 500) : null;
  const voiceExamples = stringArray(body.voiceExamples, MAX_VOICE_EXAMPLES_ACCEPTED, 2_000);
  const recentDrafts = stringArray(body.recentDrafts, MAX_RECENT_DRAFTS_ACCEPTED, 2_000);
  const angleIndex = typeof body.angleIndex === "number" && Number.isFinite(body.angleIndex) ? body.angleIndex : 0;

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    return NextResponse.json(
      { error: "AI draft generation is not configured on this deployment." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  // `ai` is narrowed non-null above; capturing it in a const the closure
  // reads (rather than re-reading `ai` from an outer `let`) keeps that
  // narrowing valid for both the first attempt and the corrective retry.
  const resolvedAi = ai;

  type DraftAttemptResult = { ok: true; draft: SocialDraft } | { ok: false; status: number; error: string };

  async function requestDraft(correctiveFeedback?: string | null): Promise<DraftAttemptResult> {
    let response: Response;
    try {
      response = await fetch(resolvedAi.responsesUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${resolvedAi.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          buildDraftRequestBody(
            {
              project,
              voiceProfile,
              dayLabel,
              theme,
              likedSampleLines,
              directionBrief,
              voiceExamples,
              recentDrafts,
              angleIndex,
              correctiveFeedback,
            },
            resolvedAi.model,
          ),
        ),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      console.error("Draft request failed before receiving a response", error instanceof Error ? error.message : error);
      return { ok: false, status: 502, error: "The draft request could not reach the AI provider. Try again." };
    }

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      console.error("Draft request failed", response.status, message.slice(0, 500));
      return { ok: false, status: 502, error: "The draft request failed. Try again." };
    }

    let payload: OpenAIResponse;
    try {
      payload = (await response.json()) as OpenAIResponse;
    } catch {
      return { ok: false, status: 502, error: "The AI returned an invalid response." };
    }

    const parsed = parseDraftResponseDetailed(payload);
    if (!parsed.ok) {
      console.error("Draft parse failed", parsed);
      const incomplete = parsed.reason === "empty_output" || parsed.reason === "json_parse_error";
      return {
        ok: false,
        status: 502,
        error: incomplete
          ? "The AI response was incomplete. Try again."
          : "The AI response didn't match the expected format. Try again.",
      };
    }

    return { ok: true, draft: parsed.draft };
  }

  let result = await requestDraft();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, headers: noStoreHeaders(rateHeaders) });
  }

  // Mechanical post-parse guard (issue #362): the required post form is a
  // prompt instruction, not a guarantee. On a violation, regenerate exactly
  // once with corrective feedback naming it; if the retry itself fails for
  // any reason, fail open and return the original draft rather than
  // erroring, since a slightly off-form draft is better than none — the
  // user reviews/edits every draft before posting anyway.
  const compliance = checkDraftAngleCompliance(result.draft.xText, { theme, angleIndex });
  if (compliance.violated) {
    const retryResult = await requestDraft(compliance.feedback);
    if (retryResult.ok) {
      result = retryResult;
    }
  }

  return NextResponse.json({ draft: result.draft }, { headers: noStoreHeaders(rateHeaders) });
}
