import { NextResponse } from "next/server";
import { findElementDefinition, findPageDefinition } from "@/lib/page-content-registry";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { publishAllPageDrafts, publishPageElement } from "@/lib/server/page-content";
import {
  NoDraftPendingError,
  PageContentStoreUnavailableError,
  getPageContentStore,
} from "@/lib/server/page-content-store";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const ACTIONS = ["publish", "publish-all", "discard", "reset"] as const;
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
    {
      error: "The page content registry is not ready. Apply the latest database migrations and try again.",
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

/**
 * Draft lifecycle actions for the "Pages" CMS: publish one element, publish
 * every pending draft on a page, discard a draft, or stage the registry
 * default back into draft ("reset to default") so it goes through the same
 * preview-then-publish flow as any other edit.
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
    const pageId = typeof body?.pageId === "string" ? body.pageId : "";
    const elementId = typeof body?.elementId === "string" ? body.elementId : "";
    const action = body?.action;

    const page = findPageDefinition(pageId);
    if (!page || !isAction(action)) {
      return NextResponse.json({ error: "A valid page and action are required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (action === "publish-all") {
      const results = await publishAllPageDrafts({ pageId, actor: "admin" });
      return NextResponse.json(
        { published: results.map((result) => result.entry) },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    const element = findElementDefinition(pageId, elementId);
    if (!element) {
      return NextResponse.json({ error: "A valid element is required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (action === "publish") {
      const result = await publishPageElement({ pageId, elementId, elementLabel: element.label, actor: "admin" });
      return NextResponse.json({ entry: result.entry }, { status: 200, headers: NO_STORE_HEADERS });
    }

    if (action === "discard") {
      const entry = await getPageContentStore().discardDraft({ pageId, elementId });
      return NextResponse.json({ entry }, { status: 200, headers: NO_STORE_HEADERS });
    }

    // action === "reset": stage the registry default as a draft so it must
    // still go through Preview → Publish like any other content change.
    const entry = await getPageContentStore().saveDraft({
      pageId,
      elementId,
      elementType: element.type,
      value: element.defaultValue,
      actor: "admin",
    });
    return NextResponse.json({ entry }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof NoDraftPendingError) {
      return NextResponse.json({ error: "There is no pending draft to publish for this element." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof PageContentStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin page content action failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json({ error: "The action could not be completed. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
