import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  getPreviewPageContent,
  getPublishedPageContent,
  publishAllPageDrafts,
  publishPageElement,
  resolvePageContent,
} from "@/lib/server/page-content";
import {
  createMemoryPageContentStore,
  resetPageContentStoreForTests,
  setPageContentStoreForTests,
} from "@/lib/server/page-content-store";

let cookieJar = new Map<string, { value: string }>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
  }),
}));

beforeEach(() => {
  cookieJar = new Map();
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
});

afterEach(() => {
  resetAdminStoresForTests();
  resetAdminOperationsStoreForTests();
  resetPageContentStoreForTests();
});

describe("getPublishedPageContent", () => {
  it("falls back to registry defaults for an unknown page id", async () => {
    await expect(getPublishedPageContent("not-a-page")).resolves.toEqual({});
  });

  it("falls back to registry defaults when nothing has ever been published", async () => {
    setPageContentStoreForTests(createMemoryPageContentStore());
    const content = await getPublishedPageContent("bonding-curve");
    expect(content.hero_title).toBe("Bonding Curve");
    expect(content.primary_cta_link).toBe("/testnet");
  });

  it("returns the published value once an element has been published", async () => {
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Published title",
      actor: "admin",
    });
    await store.publish({ pageId: "bonding-curve", elementId: "hero_title", actor: "admin" });

    const content = await getPublishedPageContent("bonding-curve");
    expect(content.hero_title).toBe("Published title");
    // Untouched elements still fall back to their default.
    expect(content.primary_cta_link).toBe("/testnet");
  });

  it("never has a pending draft leak into the published read path", async () => {
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Unpublished draft",
      actor: "admin",
    });

    const content = await getPublishedPageContent("bonding-curve");
    expect(content.hero_title).toBe("Bonding Curve");
  });

  it("falls back to defaults, never throwing, when the store is unreachable", async () => {
    resetPageContentStoreForTests(); // no DATABASE_URL configured in this test env
    await expect(getPublishedPageContent("bonding-curve")).resolves.toMatchObject({
      hero_title: "Bonding Curve",
    });
  });

  it("registers the /support page (issue #393 review) with its default chrome copy", async () => {
    const content = await getPublishedPageContent("support");
    expect(content.hero_eyebrow).toBe("SUPPORT");
    expect(content.hero_title).toBe("Report a problem");
    expect(content.hero_intro).toContain("never your credentials");
  });
});

describe("getPreviewPageContent", () => {
  it("shows a pending draft over the published value", async () => {
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Published title",
      actor: "admin",
    });
    await store.publish({ pageId: "bonding-curve", elementId: "hero_title", actor: "admin" });
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Staged draft title",
      actor: "admin",
    });

    const content = await getPreviewPageContent("bonding-curve");
    expect(content.hero_title).toBe("Staged draft title");
  });
});

describe("resolvePageContent", () => {
  it("ignores the preview flag with no session cookie, serving published content", async () => {
    const { content, isPreview } = await resolvePageContent("bonding-curve", "1");
    expect(isPreview).toBe(false);
    expect(content.hero_title).toBe("Bonding Curve");
  });

  it("ignores the preview flag with an invalid/expired session cookie", async () => {
    cookieJar.set("hoodlums_admin_session", { value: "not-a-real-session" });
    const { isPreview } = await resolvePageContent("bonding-curve", "1");
    expect(isPreview).toBe(false);
  });

  it("serves preview (draft-merged) content only with the flag AND a valid admin session", async () => {
    const token = "a-real-admin-session-token";
    await createAdminSession(hashAdminSessionToken(token));
    cookieJar.set("hoodlums_admin_session", { value: token });

    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Preview-only title",
      actor: "admin",
    });

    const withoutFlag = await resolvePageContent("bonding-curve", undefined);
    expect(withoutFlag.isPreview).toBe(false);
    expect(withoutFlag.content.hero_title).toBe("Bonding Curve");

    const withFlag = await resolvePageContent("bonding-curve", "1");
    expect(withFlag.isPreview).toBe(true);
    expect(withFlag.content.hero_title).toBe("Preview-only title");
  });

  it("resolves published/preview support-page content the same way as every other registered page", async () => {
    const token = "a-real-admin-session-token";
    await createAdminSession(hashAdminSessionToken(token));
    cookieJar.set("hoodlums_admin_session", { value: token });

    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({
      pageId: "support",
      elementId: "hero_title",
      elementType: "heading",
      value: "Preview-only support title",
      actor: "admin",
    });

    const withoutFlag = await resolvePageContent("support", undefined);
    expect(withoutFlag.content.hero_title).toBe("Report a problem");

    const withFlag = await resolvePageContent("support", "1");
    expect(withFlag.isPreview).toBe(true);
    expect(withFlag.content.hero_title).toBe("Preview-only support title");
  });
});

describe("publishPageElement / publishAllPageDrafts", () => {
  it("publishes and records an activity entry describing the change", async () => {
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "New hero title",
      actor: "admin",
    });

    await publishPageElement({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementLabel: "Hero title",
      actor: "admin",
    });

    const activity = await (await import("@/lib/server/admin-operations-store")).getAdminOperationsStore().listActivity(10);
    expect(activity[0]).toMatchObject({ kind: "page-content-published" });
    expect(activity[0].message).toContain("Hero title");
    expect(activity[0].message).toContain("New hero title");
  });

  it("publishes every drafted element on a page and logs each one", async () => {
    const store = createMemoryPageContentStore();
    setPageContentStoreForTests(store);
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Title",
      actor: "admin",
    });
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_intro",
      elementType: "text",
      value: "Intro",
      actor: "admin",
    });

    const results = await publishAllPageDrafts({ pageId: "bonding-curve", actor: "admin" });
    expect(results).toHaveLength(2);

    const activity = await (await import("@/lib/server/admin-operations-store")).getAdminOperationsStore().listActivity(10);
    expect(activity.filter((item) => item.kind === "page-content-published")).toHaveLength(2);
  });
});
