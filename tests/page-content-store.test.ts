import { describe, expect, it } from "vitest";
import {
  NoDraftPendingError,
  createMemoryPageContentState,
  createMemoryPageContentStore,
} from "@/lib/server/page-content-store";

describe("createMemoryPageContentStore", () => {
  it("returns nothing for a page with no rows yet", async () => {
    const store = createMemoryPageContentStore();
    await expect(store.listPage("bonding-curve")).resolves.toEqual([]);
  });

  it("stages a draft without touching the published value", async () => {
    const store = createMemoryPageContentStore();
    const entry = await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "New title",
      actor: "admin",
    });

    expect(entry).toMatchObject({ hasDraft: true, draftValue: "New title", hasPublished: false, publishedValue: "" });
  });

  it("refuses to publish an element with no pending draft", async () => {
    const store = createMemoryPageContentStore();
    await expect(
      store.publish({ pageId: "bonding-curve", elementId: "hero_title", actor: "admin" }),
    ).rejects.toBeInstanceOf(NoDraftPendingError);
  });

  it("publishes a staged draft, reporting there was no previous published value", async () => {
    const store = createMemoryPageContentStore();
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "New title",
      actor: "admin",
    });

    const result = await store.publish({ pageId: "bonding-curve", elementId: "hero_title", actor: "admin" });
    expect(result.hadPublishedBefore).toBe(false);
    expect(result.entry).toMatchObject({ hasDraft: false, hasPublished: true, publishedValue: "New title" });
  });

  it("reports the previous published value when publishing over an earlier publish", async () => {
    const store = createMemoryPageContentStore();
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "First title",
      actor: "admin",
    });
    await store.publish({ pageId: "bonding-curve", elementId: "hero_title", actor: "admin" });

    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Second title",
      actor: "admin",
    });
    const result = await store.publish({ pageId: "bonding-curve", elementId: "hero_title", actor: "admin" });

    expect(result.hadPublishedBefore).toBe(true);
    expect(result.previousPublishedValue).toBe("First title");
    expect(result.entry.publishedValue).toBe("Second title");
  });

  it("discards a draft without touching the published value", async () => {
    const store = createMemoryPageContentStore();
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "First title",
      actor: "admin",
    });
    await store.publish({ pageId: "bonding-curve", elementId: "hero_title", actor: "admin" });
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Unwanted edit",
      actor: "admin",
    });

    const discarded = await store.discardDraft({ pageId: "bonding-curve", elementId: "hero_title" });
    expect(discarded).toMatchObject({ hasDraft: false, hasPublished: true, publishedValue: "First title" });
  });

  it("returns null when discarding an element that was never staged", async () => {
    const store = createMemoryPageContentStore();
    await expect(store.discardDraft({ pageId: "bonding-curve", elementId: "hero_title" })).resolves.toBeNull();
  });

  it("publishes every pending draft on a page and leaves other pages untouched", async () => {
    const store = createMemoryPageContentStore();
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "New title",
      actor: "admin",
    });
    await store.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_intro",
      elementType: "text",
      value: "New intro",
      actor: "admin",
    });
    await store.saveDraft({
      pageId: "allocations",
      elementId: "liquidity_cta_label",
      elementType: "button_label",
      value: "Should not publish",
      actor: "admin",
    });

    const results = await store.publishAllDrafts({ pageId: "bonding-curve", actor: "admin" });
    expect(results).toHaveLength(2);
    expect(results.every((result) => !result.entry.hasDraft && result.entry.hasPublished)).toBe(true);

    const allocationsEntries = await store.listPage("allocations");
    expect(allocationsEntries[0]).toMatchObject({ hasDraft: true, hasPublished: false });
  });

  it("shares state across store instances constructed from the same state object", async () => {
    const state = createMemoryPageContentState();
    const writer = createMemoryPageContentStore(state);
    const reader = createMemoryPageContentStore(state);

    await writer.saveDraft({
      pageId: "bonding-curve",
      elementId: "hero_title",
      elementType: "heading",
      value: "Shared title",
      actor: "admin",
    });

    const entries = await reader.listPage("bonding-curve");
    expect(entries[0]).toMatchObject({ draftValue: "Shared title", hasDraft: true });
  });
});
