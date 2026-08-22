import { NextResponse } from "next/server";
import {
  SOCIAL_STUDIO_READ_LIMIT,
  consumeSocialStudioReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { socialProjectSlotLimit } from "@/lib/social-project-slots";
import { getSocialProjectSlotsStore } from "@/lib/server/social-project-slots-store";
import { authoriseSocialStudioRequest } from "@/lib/server/social-studio-entitlement";

// Read-only usage summary for the Studio UI's "Project X of Y" indicator and
// the "Use this plan slot for a different project" swap flow (issue #407).
// Like the existing hoodchat/token-chat/connections/posts GET routes, plain
// reads don't gate on an Origin header and trust the walletAddress query
// param — nothing here spends money or mutates state.

export const runtime = "nodejs";

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "Cache-Control": "no-store", ...extra };
}

export async function GET(request: Request) {
  const rate = consumeSocialStudioReadRateLimit(getClientIp(request));
  const headers = noStoreHeaders({
    "X-RateLimit-Limit": String(SOCIAL_STUDIO_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
  }

  const isolationResponse = await getServiceIsolationResponse("social-studio-ai");
  if (isolationResponse) return isolationResponse;

  const walletAddress = new URL(request.url).searchParams.get("walletAddress") || "";
  const authorisation = await authoriseSocialStudioRequest(walletAddress);
  if (authorisation.status === "invalid-wallet") {
    return NextResponse.json({ error: authorisation.message }, { status: 401, headers });
  }
  if (authorisation.status === "unavailable") {
    return NextResponse.json({ error: authorisation.message }, { status: 503, headers });
  }
  if (authorisation.status === "upsell") {
    return NextResponse.json(
      { error: authorisation.message, code: "social-studio-plan-required", upsell: true },
      { status: 403, headers },
    );
  }

  if (authorisation.accessSource === "test-allowlist") {
    return NextResponse.json(
      { plan: null, unlimited: true, limit: null, activeCount: 0, slots: [] },
      { status: 200, headers },
    );
  }

  const plan = authorisation.plan ?? null;
  if (!plan) {
    return NextResponse.json({ error: "Your plan could not be determined. Try again." }, { status: 503, headers });
  }
  const limit = socialProjectSlotLimit(plan);

  try {
    const slots = await getSocialProjectSlotsStore().listActive(authorisation.walletAddress);
    return NextResponse.json(
      {
        plan,
        unlimited: false,
        limit,
        activeCount: slots.length,
        slots: slots.map((slot) => ({
          projectId: slot.projectId,
          displayName: slot.displayName,
          registeredAt: slot.registeredAt,
        })),
      },
      { status: 200, headers },
    );
  } catch {
    return NextResponse.json(
      { error: "The project-slot registry could not be reached. Try again." },
      { status: 503, headers },
    );
  }
}
