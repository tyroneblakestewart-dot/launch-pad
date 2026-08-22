import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_ACTION_LIMIT,
  consumeSocialStudioActionRateLimit,
  getClientIp,
  isSocialStudioRequestOriginAllowed,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import {
  normaliseSocialProjectDisplayName,
  normaliseSocialProjectId,
  socialProjectSlotCooldownMessage,
} from "@/lib/social-project-slots";
import {
  SocialProjectSlotsStoreUnavailableError,
  getSocialProjectSlotsStore,
} from "@/lib/server/social-project-slots-store";
import { authoriseSocialStudioAction, type AuthoriseSocialStudioActionResult } from "@/lib/server/social-studio-action-auth";

// Wallet-signed "use this plan slot for a different project" release
// (issue #407). Follows POST /api/social/posts' shape exactly: the same
// generic wallet-signed challenge issued by POST /api/social/challenge
// (purpose "social:project-slot-release"), bound to the exact project id
// and display name shown in the client's confirmation step so a signed
// release can't be replayed against a different project. Ownership is
// enforced server-side by scoping the release query to the signature-
// verified wallet, never a client-supplied one. A user may release at most
// one slot every seven days (db/migrations/028_social_project_slots.sql);
// an admin override that bypasses that cooldown lives at
// POST /api/admin/social-project-slots/actions.

export const runtime = "nodejs";

function actionHeaders(rate: ReturnType<typeof consumeSocialStudioActionRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_ACTION_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function authFailureResponse(result: Exclude<AuthoriseSocialStudioActionResult, { status: "ok" }>, headers: Record<string, string>) {
  if (result.status === "expired") return NextResponse.json({ error: "The release challenge expired. Try again." }, { status: 410, headers });
  if (result.status === "replayed") return NextResponse.json({ error: "That release challenge has already been used." }, { status: 409, headers });
  return NextResponse.json({ error: "Wallet authorisation failed." }, { status: 401, headers });
}

export async function POST(request: Request) {
  if (!isSocialStudioRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const rate = consumeSocialStudioActionRateLimit(getClientIp(request));
  const headers = actionHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  const requestBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const projectId = normaliseSocialProjectId(requestBody?.projectId);
  const displayName = normaliseSocialProjectDisplayName(requestBody?.displayName);
  const challengeId = typeof requestBody?.challengeId === "string" ? requestBody.challengeId.trim() : "";
  const nonce = typeof requestBody?.nonce === "string" ? requestBody.nonce.trim() : "";
  const signature = typeof requestBody?.signature === "string" ? requestBody.signature.trim() : "";

  if (!projectId || !displayName) {
    return NextResponse.json({ error: "A valid project id and project name are required." }, { status: 400, headers });
  }
  if (!challengeId || !nonce || !signature) {
    return NextResponse.json({ error: "A valid release challenge and signature are required." }, { status: 400, headers });
  }

  const authorisation = await authoriseSocialStudioAction({
    purpose: "social:project-slot-release",
    payload: { projectId, displayName },
    challengeId,
    nonce,
    signature,
  });
  if (authorisation.status !== "ok") return authFailureResponse(authorisation, headers);

  try {
    const result = await getSocialProjectSlotsStore().releaseByUser({
      walletAddress: authorisation.walletAddress,
      projectId,
    });
    if (result.status === "not_found") {
      return NextResponse.json({ error: "That project slot could not be found." }, { status: 404, headers });
    }
    if (result.status === "cooldown") {
      return NextResponse.json(
        { error: socialProjectSlotCooldownMessage(result.nextReleaseAllowedAt), nextReleaseAllowedAt: result.nextReleaseAllowedAt },
        { status: 409, headers },
      );
    }

    void recordAdminActivityBestEffort({
      kind: "slot-released-by-user",
      serviceKey: "social-studio-ai",
      message: `Project slot released by ${authorisation.walletAddress}: ${displayName} (${projectId}).`,
    });

    return NextResponse.json(
      { releasedAt: result.releasedAt, nextReleaseAllowedAt: result.nextReleaseAllowedAt },
      { status: 200, headers },
    );
  } catch (error) {
    const unavailable = error instanceof SocialProjectSlotsStoreUnavailableError;
    return NextResponse.json(
      { error: unavailable ? "The project-slot registry is not configured on this deployment." : "The project slot could not be released." },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
