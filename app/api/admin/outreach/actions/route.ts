import { NextResponse } from "next/server";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { recordAdminActivityBestEffort } from "@/lib/server/admin-operations-store";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { approveOutreachDraft } from "@/lib/server/outreach-approve";
import { getOutreachStore, OutreachStoreUnavailableError } from "@/lib/server/outreach-store";
import { isOutreachPostingConfigured } from "@/lib/server/outreach-x-client";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const ACTIONS = ["approve", "edit", "dismiss"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

async function isAuthenticated(request: Request): Promise<boolean> {
  const token = parseAdminSessionCookie(request.headers.get("cookie"));
  return Boolean(token && (await isAdminSessionValid(hashAdminSessionToken(token))));
}

function storageUnavailableResponse() {
  return NextResponse.json(
    { error: "The outreach queue is not ready. Apply the latest database migrations and try again." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

function dormantResponse() {
  return NextResponse.json(
    { error: "posting not configured — outreach is dormant" },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

/**
 * Draft lifecycle actions for the "Outreach" queue: approve (posts via the
 * X API), edit the draft body, or dismiss. Mirrors
 * app/api/admin/pages/actions/route.ts's auth/origin/error-mapping pattern.
 * The approve action independently re-checks posting configuration here —
 * even if a compromised/buggy UI sent the request, this route still 503s
 * rather than trusting the client to have disabled the button.
 */
export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json({ error: "Admin request origin is not allowed." }, { status: 403, headers: NO_STORE_HEADERS });
    }
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === "string" ? body.id : "";
    const action = body?.action;
    if (!id || !isAction(action)) {
      return NextResponse.json({ error: "A valid draft id and action are required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (action === "approve") {
      // Defense in depth: independent of any UI state, and independent of
      // approveOutreachDraft's own internal check.
      if (!isOutreachPostingConfigured()) return dormantResponse();

      const result = await approveOutreachDraft(id);
      if (result.status === "not_configured") return dormantResponse();
      if (result.status === "not_found") {
        return NextResponse.json({ error: "Draft not found." }, { status: 404, headers: NO_STORE_HEADERS });
      }
      if (result.status === "not_pending") {
        return NextResponse.json({ error: "Only pending drafts can be approved." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      if (result.status === "posted") {
        await recordAdminActivityBestEffort({
          kind: "outreach-posted",
          serviceKey: "outreach",
          message: `Outreach draft for ${result.item.tokenName} ($${result.item.tokenTicker}) posted to X.`,
        });
      }
      // "failed" still returns 200: the request was handled correctly, and
      // the queue item itself now carries the failure reason for the UI.
      return NextResponse.json({ item: result.item }, { status: 200, headers: NO_STORE_HEADERS });
    }

    if (action === "edit") {
      const newBody = typeof body?.body === "string" ? body.body.trim() : "";
      if (!newBody) {
        return NextResponse.json({ error: "A non-empty draft body is required." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      const result = await getOutreachStore().editDraft(id, newBody);
      if (result.status === "not_found") {
        return NextResponse.json({ error: "Draft not found." }, { status: 404, headers: NO_STORE_HEADERS });
      }
      if (result.status === "not_pending") {
        return NextResponse.json({ error: "Only pending drafts can be edited." }, { status: 400, headers: NO_STORE_HEADERS });
      }
      return NextResponse.json({ item: result.item }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // action === "dismiss"
    const result = await getOutreachStore().dismissDraft(id);
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Draft not found." }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (result.status === "not_pending") {
      return NextResponse.json({ error: "Only pending drafts can be dismissed." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    await recordAdminActivityBestEffort({
      kind: "outreach-dismissed",
      serviceKey: "outreach",
      message: `Outreach draft for ${result.item.tokenName} ($${result.item.tokenTicker}) dismissed.`,
    });
    return NextResponse.json({ item: result.item }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof OutreachStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin outreach action failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json({ error: "The action could not be completed. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
