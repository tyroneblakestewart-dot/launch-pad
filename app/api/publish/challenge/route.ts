import { NextResponse } from "next/server";
import {
  PUBLISH_NONCE_TTL_MS,
  buildPublishAuthorisationMessage,
  createPublishNonce,
  hashPublishNonce,
  normalisePublishWalletAddress,
  normaliseWalletChainId,
} from "@/lib/server/publish-auth";
import {
  PUBLISH_CHALLENGE_LIMIT,
  consumePublishChallengeRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getPublishStore, PublishStoreUnavailableError } from "@/lib/server/publish-store";
import {
  hashPublishableSite,
  normalisePublishableSite,
} from "@/lib/server/published-site-validation";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { validateSlug } from "@/lib/slug";

export const runtime = "nodejs";

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

function responseHeaders(rate: ReturnType<typeof consumePublishChallengeRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(PUBLISH_CHALLENGE_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json(
      { error: "Publish challenge origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumePublishChallengeRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many publish challenge requests. Try again later." },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("public-publishing");
  if (isolationResponse) return isolationResponse;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const walletAddress = normalisePublishWalletAddress(body?.walletAddress);
  const walletChainId = normaliseWalletChainId(body?.walletChainId);
  const siteValidation = normalisePublishableSite(body?.site);

  if (!walletAddress || !walletChainId) {
    return NextResponse.json(
      { error: "A valid EVM wallet address and wallet chain ID are required." },
      { status: 400, headers },
    );
  }
  if (!siteValidation.valid) {
    return NextResponse.json(
      { error: siteValidation.reason },
      { status: 400, headers },
    );
  }

  const slugValidation = validateSlug(siteValidation.site.slug);
  if (!slugValidation.valid) {
    return NextResponse.json(
      { error: slugValidation.reason },
      { status: 400, headers },
    );
  }

  const nonce = createPublishNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + PUBLISH_NONCE_TTL_MS);
  const sitePayloadHash = hashPublishableSite(siteValidation.site);

  try {
    const challenge = await getPublishStore().createChallenge({
      nonceHash: hashPublishNonce(nonce),
      walletAddress,
      slug: siteValidation.site.slug,
      walletChainId,
      sitePayloadHash,
      issuedAt,
      expiresAt,
    });
    const message = buildPublishAuthorisationMessage({ ...challenge, nonce });

    return NextResponse.json(
      {
        challengeId: challenge.id,
        walletAddress: challenge.walletAddress,
        walletChainId: challenge.walletChainId,
        slug: challenge.slug,
        sitePayloadHash: challenge.sitePayloadHash,
        nonce,
        message,
        issuedAt: challenge.issuedAt.toISOString(),
        expiresAt: challenge.expiresAt.toISOString(),
      },
      { status: 201, headers },
    );
  } catch (error) {
    const unavailable = error instanceof PublishStoreUnavailableError;
    return NextResponse.json(
      {
        error: unavailable
          ? "Public publishing is not configured on this deployment."
          : "The publish challenge could not be created.",
      },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
