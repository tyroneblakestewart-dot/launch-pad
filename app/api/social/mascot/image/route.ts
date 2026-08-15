import { NextResponse } from "next/server";
import {
  SOCIAL_MASCOT_IMAGE_LIMIT,
  consumeSocialMascotImageRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { getVercelOidcToken, resolveAIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { buildMascotImagePrompt, type MascotVisualDNA } from "@/lib/server/mascot-prompt-builder";
import { requestMascotImage } from "@/lib/server/mascot-image-request";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";

export const runtime = "nodejs";
export const maxDuration = 45;

type MascotImageRequestBody = {
  walletAddress?: unknown;
  project?: { name?: unknown; ticker?: unknown };
  mascotVisualDNA?: unknown;
  sceneInput?: unknown;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

function isMascotVisualDNA(value: unknown): value is MascotVisualDNA {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.characterDescription === "string" &&
    typeof candidate.colourPalette === "string" &&
    typeof candidate.signatureProps === "string" &&
    typeof candidate.artStyle === "string"
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
      return NextResponse.json({ error: "Unauthorised mascot-image request." }, { status: 401, headers: noStoreHeaders() });
    }
    const rate = consumeSocialMascotImageRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(SOCIAL_MASCOT_IMAGE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Mascot-image rate limit exceeded. Try again later." },
        { status: 429, headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }) },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  let body: MascotImageRequestBody;
  try {
    body = (await request.json()) as MascotImageRequestBody;
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
  const sceneInput = typeof body.sceneInput === "string" ? body.sceneInput.trim().slice(0, 200) : "";
  if (!name || !ticker) {
    return NextResponse.json({ error: "A project name and ticker are required." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  if (!sceneInput) {
    return NextResponse.json({ error: "Choose or describe a scene for the mascot." }, { status: 400, headers: noStoreHeaders(rateHeaders) });
  }
  if (!isMascotVisualDNA(body.mascotVisualDNA)) {
    return NextResponse.json(
      { error: "Upload a mascot reference image first so its visual identity can be locked in." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const ai = resolveAIResponsesRuntime(process.env, getVercelOidcToken(request));
  if (!ai) {
    return NextResponse.json(
      { error: "AI image generation is not configured on this deployment." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const { prompt } = buildMascotImagePrompt(body.mascotVisualDNA, sceneInput, { name, ticker });
  const result = await requestMascotImage(ai, prompt);

  if (!result.ok) {
    if (result.kind === "unsupported-provider") {
      return NextResponse.json(
        {
          error:
            "Mascot image generation needs a direct OpenAI API key on this deployment; it isn't available through the fallback AI gateway yet.",
        },
        { status: 503, headers: noStoreHeaders(rateHeaders) },
      );
    }
    return NextResponse.json(
      { error: "Mascot image generation failed. Try again." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json({ imageDataUrl: result.imageDataUrl }, { headers: noStoreHeaders(rateHeaders) });
}
