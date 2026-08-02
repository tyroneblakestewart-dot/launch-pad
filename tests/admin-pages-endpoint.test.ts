import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getPages, PATCH as patchPages } from "@/app/api/admin/pages/route";
import { POST as postPagesAction } from "@/app/api/admin/pages/actions/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  createMemoryAdminOperationsStore,
  getAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  createMemoryPageContentStore,
  resetPageContentStoreForTests,
  setPageContentStoreForTests,
} from "@/lib/server/page-content-store";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-pages-test-session-token";
let cookie = "";

function request(
  method: string,
  path: string,
  body?: unknown,
  options: { authenticated?: boolean; origin?: string } = {},
): Request {
  const { authenticated = true, origin = ORIGIN } = options;
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { Origin: origin } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
  setPageContentStoreForTests(createMemoryPageContentStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetAdminOperationsStoreForTests();
  resetPageContentStoreForTests();
});

describe("GET /api/admin/pages", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getPages(request("GET", "/api/admin/pages", undefined, { authenticated: false }));
    expect(response.status).toBe(401);
  });

  it("lists every registered page with defaults and no draft/published state", async () => {
    const response = await getPages(request("GET", "/api/admin/pages"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      pages: Array<{ id: string; elements: Array<{ id: string; displayValue: string; hasDraft: boolean }> }>;
    };
    const bondingCurve = payload.pages.find((page) => page.id === "bonding-curve");
    expect(bondingCurve).toBeTruthy();
    const heroTitle = bondingCurve?.elements.find((element) => element.id === "hero_title");
    expect(heroTitle).toMatchObject({ displayValue: "Bonding Curve", hasDraft: false });
  });
});

describe("PATCH /api/admin/pages", () => {
  it("rejects a disallowed origin", async () => {
    const response = await patchPages(
      request(
        "PATCH",
        "/api/admin/pages",
        { pageId: "bonding-curve", elementId: "hero_title", value: "New title" },
        { origin: "https://evil.example.com" },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unregistered page or element", async () => {
    const response = await patchPages(
      request("PATCH", "/api/admin/pages", { pageId: "nonsense", elementId: "nonsense", value: "x" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a value that fails sanitisation (e.g. an http:// link)", async () => {
    const response = await patchPages(
      request("PATCH", "/api/admin/pages", { pageId: "bonding-curve", elementId: "primary_cta_link", value: "http://example.com" }),
    );
    expect(response.status).toBe(400);
  });

  it("strips any HTML tags from a submitted value before staging the draft", async () => {
    const response = await patchPages(
      request("PATCH", "/api/admin/pages", {
        pageId: "bonding-curve",
        elementId: "hero_title",
        value: "<img src=x onerror=alert(1)>Hi",
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { entry: { draftValue: string } };
    expect(payload.entry.draftValue).not.toContain("<img");
    expect(payload.entry.draftValue).toContain("Hi");
  });

  it("stages a draft without publishing it", async () => {
    await patchPages(
      request("PATCH", "/api/admin/pages", { pageId: "bonding-curve", elementId: "hero_title", value: "Draft title" }),
    );
    const listing = await getPages(request("GET", "/api/admin/pages"));
    const payload = (await listing.json()) as {
      pages: Array<{ id: string; elements: Array<{ id: string; hasDraft: boolean; hasPublished: boolean; displayValue: string }> }>;
    };
    const element = payload.pages
      .find((page) => page.id === "bonding-curve")
      ?.elements.find((item) => item.id === "hero_title");
    expect(element).toMatchObject({ hasDraft: true, hasPublished: false, displayValue: "Draft title" });
  });
});

describe("POST /api/admin/pages/actions", () => {
  async function stageDraft(value = "Draft title") {
    await patchPages(
      request("PATCH", "/api/admin/pages", { pageId: "bonding-curve", elementId: "hero_title", value }),
    );
  }

  it("rejects unauthenticated requests", async () => {
    const response = await postPagesAction(
      request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "publish" }, { authenticated: false }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses to publish when there is no pending draft", async () => {
    const response = await postPagesAction(
      request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "publish" }),
    );
    expect(response.status).toBe(400);
  });

  it("publishes a staged draft and records it in the activity log with the old and new value", async () => {
    await stageDraft("Published title");
    const response = await postPagesAction(
      request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "publish" }),
    );
    expect(response.status).toBe(200);

    const listing = await getPages(request("GET", "/api/admin/pages"));
    const payload = (await listing.json()) as {
      pages: Array<{ id: string; elements: Array<{ id: string; hasDraft: boolean; hasPublished: boolean; publishedValue: string }> }>;
    };
    const element = payload.pages
      .find((page) => page.id === "bonding-curve")
      ?.elements.find((item) => item.id === "hero_title");
    expect(element).toMatchObject({ hasDraft: false, hasPublished: true, publishedValue: "Published title" });

    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity[0].kind).toBe("page-content-published");
    expect(activity[0].message).toContain("Bonding Curve");
    expect(activity[0].message).toContain("Published title");
  });

  it("discards a staged draft, leaving the published value untouched", async () => {
    await stageDraft("Published title");
    await postPagesAction(request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "publish" }));
    await stageDraft("Unwanted edit");

    const response = await postPagesAction(
      request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "discard" }),
    );
    expect(response.status).toBe(200);

    const listing = await getPages(request("GET", "/api/admin/pages"));
    const payload = (await listing.json()) as {
      pages: Array<{ id: string; elements: Array<{ id: string; hasDraft: boolean; displayValue: string }> }>;
    };
    const element = payload.pages
      .find((page) => page.id === "bonding-curve")
      ?.elements.find((item) => item.id === "hero_title");
    expect(element).toMatchObject({ hasDraft: false, displayValue: "Published title" });
  });

  it("stages the registry default as a new draft on reset, requiring a publish to take effect", async () => {
    await stageDraft("Published title");
    await postPagesAction(request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "publish" }));

    const resetResponse = await postPagesAction(
      request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "reset" }),
    );
    expect(resetResponse.status).toBe(200);

    const listingBeforePublish = await getPages(request("GET", "/api/admin/pages"));
    const beforePayload = (await listingBeforePublish.json()) as {
      pages: Array<{ id: string; elements: Array<{ id: string; hasDraft: boolean; publishedValue: string; displayValue: string }> }>;
    };
    const beforeElement = beforePayload.pages
      .find((page) => page.id === "bonding-curve")
      ?.elements.find((item) => item.id === "hero_title");
    expect(beforeElement).toMatchObject({ hasDraft: true, publishedValue: "Published title", displayValue: "Bonding Curve" });

    await postPagesAction(request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", elementId: "hero_title", action: "publish" }));
    const listingAfterPublish = await getPages(request("GET", "/api/admin/pages"));
    const afterPayload = (await listingAfterPublish.json()) as {
      pages: Array<{ id: string; elements: Array<{ id: string; publishedValue: string }> }>;
    };
    const afterElement = afterPayload.pages
      .find((page) => page.id === "bonding-curve")
      ?.elements.find((item) => item.id === "hero_title");
    expect(afterElement?.publishedValue).toBe("Bonding Curve");
  });

  it("publishes every pending draft on a page at once", async () => {
    await stageDraft("New hero title");
    await patchPages(
      request("PATCH", "/api/admin/pages", { pageId: "bonding-curve", elementId: "hero_intro", value: "New hero intro" }),
    );

    const response = await postPagesAction(
      request("POST", "/api/admin/pages/actions", { pageId: "bonding-curve", action: "publish-all" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { published: Array<{ elementId: string }> };
    expect(payload.published.map((entry) => entry.elementId).sort()).toEqual(["hero_intro", "hero_title"]);
  });
});
