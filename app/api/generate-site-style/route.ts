import { NextResponse } from "next/server";
import {
  buildOpenAIRequestBody,
  isValidImageDataUrl,
  normaliseGenerateSiteStyleRequest,
  parseSiteStyleResponse,
  type GenerateSiteStyleRequest,
  type OpenAIResponse,
} from "@/lib/server/generate-site-style";
import {
  GENERATE_SITE_STYLE_LIMIT,
  consumeGenerateSiteStyleRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";

export const runtime = "nodejs";

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin = process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";

  if (!sharedSecret) {
    return NextResponse.json(
      { error: "Artwork generation access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  if (!isGenerateSiteStyleRequestAuthorised(request, sharedSecret, allowedOrigin)) {
    return NextResponse.json(
      { error: "Unauthorised artwork-generation request." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const rate = consumeGenerateSiteStyleRateLimit(getClientIp(request));
  const rateHeaders = {
    "RateLimit-Limit": String(GENERATE_SITE_STYLE_LIMIT),
    "RateLimit-Remaining": String(rate.remaining),
    "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Artwork generation rate limit exceeded. Try again later." },
      {
        status: 429,
        headers: noStoreHeaders({ ...rateHeaders, "Retry-After": String(rate.retryAfterSeconds) }),
      },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI style generation is not configured. The browser artwork matcher will be used." },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let body: GenerateSiteStyleRequest;
  try {
    body = (await request.json()) as GenerateSiteStyleRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const input = normaliseGenerateSiteStyleRequest(body);
  if (!isValidImageDataUrl(input.imageDataUrl)) {
    return NextResponse.json(
      { error: "A valid optimised artwork image is required." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildOpenAIRequestBody(input, process.env.OPENAI_VISION_MODEL || "gpt-5-mini"),
      ),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error(
      "OpenAI site-style request failed before receiving a response",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "AI analysis was unavailable. The browser artwork matcher will be used." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    console.error("OpenAI site-style request failed", response.status, message.slice(0, 500));
    return NextResponse.json(
      { error: "AI analysis was unavailable. The browser artwork matcher will be used." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  let payload: OpenAIResponse;
  try {
    payload = (await response.json()) as OpenAIResponse;
  } catch {
    return NextResponse.json(
      { error: "AI returned an invalid design. The browser artwork matcher will be used." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const style = parseSiteStyleResponse(payload);
  if (!style) {
    return NextResponse.json(
      { error: "AI returned an invalid design. The browser artwork matcher will be used." },
      { status: 502, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(
    { style: { ...style, source: "openai" } },
    { headers: noStoreHeaders(rateHeaders) },
  );
}
