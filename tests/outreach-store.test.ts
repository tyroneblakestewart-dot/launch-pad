import { afterEach, describe, expect, it } from "vitest";
import {
  getOutreachStore,
  OutreachStoreUnavailableError,
  resetOutreachStoreForTests,
  setOutreachStoreForTests,
  type InsertOutreachDraftInput,
} from "@/lib/server/outreach-store";
import { createMemoryOutreachStore } from "./outreach-test-helpers";

afterEach(() => {
  resetOutreachStoreForTests();
  delete process.env.DATABASE_URL;
});

function draft(overrides: Partial<InsertOutreachDraftInput> = {}): InsertOutreachDraftInput {
  return {
    touch: "first",
    tokenMint: "Mint1",
    tokenName: "Doggo",
    tokenTicker: "DOGGO",
    tokenArtworkUrl: "https://example.com/art.png",
    tokenUrl: "https://pump.fun/coin/Mint1",
    progressPercent: 91,
    creatorXHandle: "doggocreator",
    templateKey: "first-board-doesnt-lie",
    body: "congrats @hoodlumsdev $DOGGO",
    ...overrides,
  };
}

describe("unconfigured outreach store (no DATABASE_URL)", () => {
  it("fails safe on read paths without throwing, and throws only on write paths", async () => {
    delete process.env.DATABASE_URL;
    const store = getOutreachStore();

    await expect(store.listItems("all")).resolves.toEqual([]);
    await expect(store.countDraftsInsertedToday()).resolves.toBe(0);
    await expect(store.getItem("nonexistent")).resolves.toBeNull();
    await expect(store.getLastTemplateKey("first")).resolves.toBeNull();
    await expect(store.listFollowUpCandidateMints(95)).resolves.toEqual([]);

    await expect(store.insertDraftIfEligible(draft(), 10)).rejects.toBeInstanceOf(OutreachStoreUnavailableError);
    await expect(store.editDraft("id", "body")).rejects.toBeInstanceOf(OutreachStoreUnavailableError);
    await expect(store.dismissDraft("id")).rejects.toBeInstanceOf(OutreachStoreUnavailableError);
    await expect(store.markPosted("id", "x1")).rejects.toBeInstanceOf(OutreachStoreUnavailableError);
    await expect(store.markFailed("id", "boom")).rejects.toBeInstanceOf(OutreachStoreUnavailableError);
  });
});

describe("dedupe (issue #298 core rule)", () => {
  it("rejects a second first-touch draft for the same mint, even after the first was dismissed", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);

    const first = await store.insertDraftIfEligible(draft({ tokenMint: "Mint1", creatorXHandle: "creatorA" }), 10);
    expect(first.status).toBe("inserted");
    if (first.status !== "inserted") throw new Error("expected inserted");
    await store.dismissDraft(first.item.id);

    const second = await store.insertDraftIfEligible(
      draft({ tokenMint: "Mint1", creatorXHandle: "creatorB", templateKey: "first-just-cracked" }),
      10,
    );
    expect(second.status).toBe("duplicate");
  });

  it("rejects a second first-touch draft for a different mint sharing the same creator handle (case-insensitive)", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);

    const first = await store.insertDraftIfEligible(draft({ tokenMint: "Mint1", creatorXHandle: "SharedCreator" }), 10);
    expect(first.status).toBe("inserted");

    const second = await store.insertDraftIfEligible(
      draft({ tokenMint: "Mint2", creatorXHandle: "sharedcreator", templateKey: "first-just-cracked" }),
      10,
    );
    expect(second.status).toBe("duplicate");
  });

  it("allows a follow-up for a posted mint, but only once", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);

    const first = await store.insertDraftIfEligible(draft({ tokenMint: "Mint1", creatorXHandle: "creatorA" }), 10);
    if (first.status !== "inserted") throw new Error("expected inserted");
    await store.markPosted(first.item.id, "x-post-1");

    const followUp = await store.insertDraftIfEligible(
      draft({ touch: "followup", tokenMint: "Mint1", creatorXHandle: "creatorA", templateKey: "followup-caught-it-early" }),
      10,
    );
    expect(followUp.status).toBe("inserted");

    const secondFollowUp = await store.insertDraftIfEligible(
      draft({ touch: "followup", tokenMint: "Mint1", creatorXHandle: "creatorA", templateKey: "followup-official" }),
      10,
    );
    expect(secondFollowUp.status).toBe("duplicate");
  });

  it("allows a first-touch draft with no creator handle to coexist with others that also have none", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);

    const first = await store.insertDraftIfEligible(draft({ tokenMint: "Mint1", creatorXHandle: null }), 10);
    const second = await store.insertDraftIfEligible(draft({ tokenMint: "Mint2", creatorXHandle: null }), 10);
    expect(first.status).toBe("inserted");
    expect(second.status).toBe("inserted");
  });
});

describe("daily cap (shared across first-touch and follow-up)", () => {
  it("rejects the 11th insertion attempt once 10 have been inserted that day", async () => {
    const store = createMemoryOutreachStore(() => new Date("2026-08-13T12:00:00.000Z"));
    setOutreachStoreForTests(store);

    for (let i = 0; i < 10; i += 1) {
      const result = await store.insertDraftIfEligible(
        draft({ tokenMint: `Mint${i}`, creatorXHandle: `creator${i}`, templateKey: "first-just-cracked" }),
        10,
      );
      expect(result.status).toBe("inserted");
    }

    const eleventh = await store.insertDraftIfEligible(
      draft({ tokenMint: "Mint10", creatorXHandle: "creator10", templateKey: "first-just-cracked" }),
      10,
    );
    expect(eleventh.status).toBe("cap_reached");
    await expect(store.countDraftsInsertedToday()).resolves.toBe(10);
  });
});

describe("state transitions", () => {
  it("moves pending -> posted, and posted is terminal (cannot be re-approved or dismissed)", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const posted = await store.markPosted(inserted.item.id, "x-post-1");
    expect(posted.status).toBe("updated");
    if (posted.status === "updated") expect(posted.item.status).toBe("posted");

    await expect(store.markPosted(inserted.item.id, "x-post-2")).resolves.toEqual({ status: "not_pending" });
    await expect(store.dismissDraft(inserted.item.id)).resolves.toEqual({ status: "not_pending" });
    await expect(store.markFailed(inserted.item.id, "late failure")).resolves.toEqual({ status: "not_pending" });
  });

  it("moves pending -> dismissed, and dismissed is terminal", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const dismissed = await store.dismissDraft(inserted.item.id);
    expect(dismissed.status).toBe("updated");

    await expect(store.dismissDraft(inserted.item.id)).resolves.toEqual({ status: "not_pending" });
    await expect(store.markPosted(inserted.item.id, "x-post-1")).resolves.toEqual({ status: "not_pending" });
  });

  it("allows editing only while pending", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const edited = await store.editDraft(inserted.item.id, "edited body @hoodlumsdev $DOGGO");
    expect(edited.status).toBe("updated");
    if (edited.status === "updated") expect(edited.item.body).toBe("edited body @hoodlumsdev $DOGGO");

    await store.dismissDraft(inserted.item.id);
    await expect(store.editDraft(inserted.item.id, "too late")).resolves.toEqual({ status: "not_pending" });
  });

  it("reports not_found for an unknown id on every transition", async () => {
    const store = createMemoryOutreachStore();
    setOutreachStoreForTests(store);
    await expect(store.editDraft("nope", "x")).resolves.toEqual({ status: "not_found" });
    await expect(store.dismissDraft("nope")).resolves.toEqual({ status: "not_found" });
    await expect(store.markPosted("nope", "x1")).resolves.toEqual({ status: "not_found" });
    await expect(store.markFailed("nope", "err")).resolves.toEqual({ status: "not_found" });
  });
});
