import { NextResponse } from "next/server";
import {
  PUBLISH_SITE_LIMIT,
  consumePublishSiteRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { hashPublishNonce, verifyPublishSignature } from "@/lib/server/publish-auth";
import {
  getPublishStore,
  PublishStoreUnavailableError,
  type PublishVisibilityResult,
} from "@/lib/server/publish-store";
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

function responseHeaders(rate: ReturnType<typeof consumePublishSiteRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(PUBLISH_SITE_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function failureResponse(
  result: Exclude<PublishVisibilityResult, { status: "updated" }>,
  headers: Record<string, string>,
) {
  if (result.status === "not_owner") {
    return NextResponse.json(
      { error: "The connected wallet is not the owner of this published site." },
      { status: 403, headers },
    );
  }
  if (result.status === "site_not_found") {
    return NextResponse.json({ error: "The published site was not found." }, { status: 404, headers });
  }
  if (result.status === "nonce_expired") {
    return NextResponse.json(
      { error: "The wallet signature challenge expired. Request a new challenge." },
      { status: 410, headers },
    );
  }
  if (result.status === "nonce_replayed") {
    return NextResponse.json(
      { error: "That wallet signature challenge has already been used." },
      { status: 409, headers },
    );
  }
  return NextResponse.json(
    { error: "Wallet visibility authorisation failed." },
    { status: 401, headers },
  );
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json(
      { error: "Publish visibility origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumePublishSiteRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many publish requests. Try again later." },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9_-]{20,128}$/.test(nonce)) {
    return NextResponse.json({ error: "A valid publish challenge is required." }, { status: 400, headers });
  }
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) {
    return NextResponse.json(
      { error: "A valid wallet message signature is required." },
      { status: 400, headers },
    );
  }
  if (body?.walletAddress !== undefined) {
    return NextResponse.json(
      { error: "Do not submit an owner wallet address; ownership comes from the verified challenge." },
      { status: 400, headers },
    );
  }
  const slugValidation = validateSlug(slug);
  if (!slugValidation.valid) {
    return NextResponse.json({ error: slugValidation.reason }, { status: 400, headers });
  }

  try {
    const store = getPublishStore();
    if (!store.setVisibilityWithChallenge) {
      throw new PublishStoreUnavailableError();
    }
    const result = await store.setVisibilityWithChallenge(
      {
        challengeId,
        nonceHash: hashPublishNonce(nonce),
        slug,
        visibility: "live",
      },
      (challenge) => verifyPublishSignature(challenge, nonce, signature),
    );

    if (result.status !== "updated") return failureResponse(result, headers);
    return NextResponse.json(
      {
        live: true,
        visibility: "live",
        slug: result.site.slug,
        publicUrl: `https://hoodlums.dev/${result.site.slug}`,
      },
      { status: 200, headers },
    );
  } catch (error) {
    const unavailable = error instanceof PublishStoreUnavailableError;
    return NextResponse.json(
      {
        error: unavailable
          ? "Public publishing is not configured on this deployment."
          : "The site visibility could not be changed.",
      },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
