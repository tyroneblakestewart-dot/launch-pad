import { NextResponse } from "next/server";
import { PAGE_CONTENT_REGISTRY, findElementDefinition, findPageDefinition } from "@/lib/page-content-registry";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import { hashAdminSessionToken, parseAdminSessionCookie } from "@/lib/server/admin-auth";
import { AdminSessionStoreUnavailableError, isAdminSessionValid } from "@/lib/server/admin-session-store";
import { sanitiseContentValue } from "@/lib/server/page-content-sanitise";
import { PageContentStoreUnavailableError, getPageContentStore } from "@/lib/server/page-content-store";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

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

/** Read-only admin listing of every registered page and its elements, draft vs. published vs. default. */
export async function GET(request: Request) {
  try {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Admin sign-in is required." }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const store = getPageContentStore();
    const pages = await Promise.all(
      PAGE_CONTENT_REGISTRY.map(async (page) => {
        const entries = await store.listPage(page.id);
        const byElement = new Map(entries.map((entry) => [entry.elementId, entry]));
        return {
          id: page.id,
          label: page.label,
          route: page.route,
          elements: page.elements.map((element) => {
            const entry = byElement.get(element.id);
            const publishedValue = entry?.hasPublished ? entry.publishedValue : element.defaultValue;
            const displayValue = entry?.hasDraft ? entry.draftValue : publishedValue;
            return {
              id: element.id,
              type: element.type,
              label: element.label,
              defaultValue: element.defaultValue,
              publishedValue,
              hasPublished: Boolean(entry?.hasPublished),
              publishedAt: entry?.publishedAt ?? null,
              hasDraft: Boolean(entry?.hasDraft),
              draftValue: entry?.hasDraft ? entry.draftValue : null,
              draftUpdatedAt: entry?.draftUpdatedAt ?? null,
              displayValue,
            };
          }),
        };
      }),
    );

    return NextResponse.json({ pages }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof PageContentStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin page content listing failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json({ error: "Page content could not be loaded. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

/** Stages a draft value for one registered element. Never publishes — see /api/admin/pages/actions. */
export async function PATCH(request: Request) {
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
    const page = findPageDefinition(pageId);
    const element = findElementDefinition(pageId, elementId);
    if (!page || !element) {
      return NextResponse.json({ error: "A valid page and element are required." }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const sanitised = sanitiseContentValue(element.type, body?.value);
    if (!sanitised.ok) {
      return NextResponse.json({ error: sanitised.error }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const entry = await getPageContentStore().saveDraft({
      pageId,
      elementId,
      elementType: element.type,
      value: sanitised.value,
      actor: "admin",
    });

    return NextResponse.json({ entry }, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError || error instanceof PageContentStoreUnavailableError) {
      return storageUnavailableResponse();
    }
    console.error(
      "Admin page content draft save failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json({ error: "The draft could not be saved. Try again." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
