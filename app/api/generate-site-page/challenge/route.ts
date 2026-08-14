import { NextResponse } from "next/server";
import type { GenerateSiteStyleRequest } from "@/lib/server/generate-site-style";
import {
  BESPOKE_SITE_CHALLENGE_LIMIT,
  consumeBespokeSiteChallengeRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
} from "@/lib/server/api-protection";
import { issueBespokeSiteGenerationChallenge } from "@/lib/server/bespoke-site-entitlement";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChallengeRequest = {
  walletAddress?: unknown;
  project?: GenerateSiteStyleRequest;
};

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

export async function POST(request: Request) {
  const sharedSecret = process.env.GENERATE_SITE_STYLE_SHARED_SECRET || "";
  const allowedOrigin =
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN || "https://hoodlums.dev";
  const protectionEnabled = Boolean(sharedSecret);

  if (!protectionEnabled && process.env.NODE_ENV !== "test") {
    return NextResponse.json(
      { error: "Website generation access protection is not configured." },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (protectionEnabled) {
    if (
      !isGenerateSiteStyleRequestAuthorised(
        request,
        sharedSecret,
        allowedOrigin,
      )
    ) {
      return NextResponse.json(
        { error: "Unauthorised website-generation request." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const rate = consumeBespokeSiteChallengeRateLimit(getClientIp(request));
    rateHeaders = {
      "RateLimit-Limit": String(BESPOKE_SITE_CHALLENGE_LIMIT),
      "RateLimit-Remaining": String(rate.remaining),
      "RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    };
    if (!rate.allowed) {
      return NextResponse.json(
        {
          code: "bespoke-challenge-rate-limited",
          error: "Too many bespoke wallet checks. Try again later.",
        },
        {
          status: 429,
          headers: noStoreHeaders({
            ...rateHeaders,
            "Retry-After": String(rate.retryAfterSeconds),
          }),
        },
      );
    }
  }

  const isolationResponse = await getServiceIsolationResponse(
    "website-generation",
  );
  if (isolationResponse) return isolationResponse;

  let body: ChallengeRequest;
  try {
    body = (await request.json()) as ChallengeRequest;
  } catch {
    return NextResponse.json(
      { code: "bespoke-challenge-invalid", error: "Invalid request body." },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }

  const result = await issueBespokeSiteGenerationChallenge({
    walletAddress: body.walletAddress,
    project: body.project || {},
    requestOrigin: request.headers.get("origin") || "",
  });

  if (result.status === "invalid-request") {
    return NextResponse.json(
      { code: "bespoke-challenge-invalid", error: result.message },
      { status: 400, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (result.status === "unavailable") {
    return NextResponse.json(
      { code: "bespoke-access-unavailable", error: result.message },
      { status: 503, headers: noStoreHeaders(rateHeaders) },
    );
  }
  if (result.status === "upsell") {
    return NextResponse.json(
      {
        code: "bespoke-plan-required",
        upgradeRequired: true,
        checkoutPlan: "bond-pro-site",
        message: result.message,
      },
      { status: 403, headers: noStoreHeaders(rateHeaders) },
    );
  }

  return NextResponse.json(result.challenge, {
    status: 201,
    headers: noStoreHeaders(rateHeaders),
  });
}
