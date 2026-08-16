import { NextResponse } from "next/server";
import {
  SOCIAL_VOICE_PROFILE_LIMIT,
  consumeSocialVoiceProfileRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import type { OpenAIResponse } from "@/lib/server/generate-site-style";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";
import {
  buildVoiceProfileRequestBody,
  normaliseVoiceExamples,
  parseVoiceProfileResponseDetailed,
} from "@/lib/server/social-voice-profile-pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

type VoiceProfileRequestBody = {
  walletAddress?: unknown;
  project?: { name?: unknown; ticker?: unknown };
  examples?: unknown;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
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
      return NextResponse.json({ error: "Unauthorised voice-profile request." }, { status: 401, headers: noStoreHeaders() });
    }
    const rate = consumeSocialVoiceProfileRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(SOCIAL_VOICE_PROFILE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Voice-profile rate limit exceeded. Try again later." },
        { status: 429, headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }) },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  let body: VoiceProfileRequestBody;
  try {
    body = (await request.json()) as VoiceProfileRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  // Entitlement is decided before any AI request that can spend tokens.
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
  if (!name || !ticker) {
    return NextResponse.json({ error: "A project name and ticker are required." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  const normalisedExamples = normaliseVoiceExamples(body.examples);
  if (!normalisedExamples.ok) {
    return NextResponse.json({ error: normalisedExamples.error }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    return NextResponse.json(
      { error: "AI voice analysis is not configured on this deployment." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let response: Response;
  try {
    response = await fetch(ai.responsesUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildVoiceProfileRequestBody({ name, ticker }, normalisedExamples.examples, ai.model)),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    console.error("Voice-profile request failed before receiving a response", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "The voice-profile request could not reach the AI provider. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("Voice-profile request failed", response.status, message.slice(0, 500));
    return NextResponse.json(
      { error: "The voice-profile request failed. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let payload: OpenAIResponse;
  try {
    payload = (await response.json()) as OpenAIResponse;
  } catch {
    return NextResponse.json({ error: "The AI returned an invalid response." }, { status: 502, headers: noStoreHeaders(rateHeaders) });
  }

  const parsed = parseVoiceProfileResponseDetailed(payload, normalisedExamples.examples.length);
  if (!parsed.ok) {
    console.error("Voice-profile parse failed", parsed);
    const incomplete = parsed.reason === "empty_output" || parsed.reason === "json_parse_error";
    return NextResponse.json(
      {
        error: incomplete
          ? "The AI response was incomplete. Try again."
          : "The AI response didn't match the expected format. Try again.",
      },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json({ voiceProfile: parsed.profile }, { headers: noStoreHeaders(rateHeaders) });
}
