import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { isAddress } from "viem";
import { normaliseSocialProjectId } from "@/lib/social-project-slots";
import {
  SocialProjectSlotsStoreUnavailableError,
  getSocialProjectSlotsStore,
} from "@/lib/server/social-project-slots-store";

// Admin-session + exact-Origin-protected release, bypassing the seven-day
// user cooldown (issue #407, rule 10). Mirrors app/api/admin/support/actions/
// route.ts's shape. Only "release" is supported today — a single-action
// route rather than a generic actions dispatcher, matching
// app/api/admin/test-access/route.ts's single-purpose pattern.

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: "The project-slot registry is not ready. Apply the latest database migrations and try again." },
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

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = body?.action;
    if (action !== "release") {
      return NextResponse.json({ error: "Only the 'release' action is supported." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const walletAddress = typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";
    const projectId = normaliseSocialProjectId(body?.projectId);
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
    if (!isAddress(walletAddress) || !projectId) {
      return NextResponse.json({ error: "A valid wallet address and project id are required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const result = await getSocialProjectSlotsStore().releaseByAdmin({ walletAddress, projectId });
    if (result.status === "not_found") {
      return NextResponse.json({ error: "That project slot could not be found." }, { status: 404, headers: NO_STORE_HEADERS });
    }

    await recordAdminActivityBestEffort({
      kind: "slot-released-by-admin",
      serviceKey: "social-studio-ai",
      message: `Project slot released by admin for ${walletAddress}: ${displayName || projectId} (${projectId}).`,
    });

    return NextResponse.json({ releasedAt: result.releasedAt }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof SocialProjectSlotsStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error("Admin project-slot release failed unexpectedly.", error instanceof Error ? (error.stack ?? error.message) : error);
    return NextResponse.json({ error: "The slot could not be released. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
