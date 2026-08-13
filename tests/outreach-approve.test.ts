import { describe, expect, it } from "vitest";
import { approveOutreachDraft } from "@/lib/server/outreach-approve";
import type { InsertOutreachDraftInput } from "@/lib/server/outreach-store";
import { createMemoryOutreachStore } from "./outreach-test-helpers";

const FULL_CREDS = {
  X_OUTREACH_API_KEY: "key",
  X_OUTREACH_API_SECRET: "secret",
  X_OUTREACH_ACCESS_TOKEN: "token",
  X_OUTREACH_ACCESS_SECRET: "access-secret",
};

function draft(overrides: Partial<InsertOutreachDraftInput> = {}): InsertOutreachDraftInput {
  return {
    touch: "first",
    tokenMint: "Mint1",
    tokenName: "Doggo",
    tokenTicker: "DOGGO",
    tokenArtworkUrl: "",
    tokenUrl: "https://pump.fun/coin/Mint1",
    progressPercent: 91,
    creatorXHandle: null,
    templateKey: "first-board-doesnt-lie",
    body: "congrats @hoodlumsdev $DOGGO",
    ...overrides,
  };
}

describe("approveOutreachDraft (dormant-by-design)", () => {
  it("returns not_configured and never calls the store or the post function when credentials are absent", async () => {
    let postCalled = false;
    const result = await approveOutreachDraft("any-id", {
      env: {},
      post: async () => {
        postCalled = true;
        return { status: "posted", xPostId: "x" };
      },
    });
    expect(result).toEqual({ status: "not_configured" });
    expect(postCalled).toBe(false);
  });

  it("returns not_found for an unknown draft id", async () => {
    const store = createMemoryOutreachStore();
    const result = await approveOutreachDraft("unknown", { env: FULL_CREDS, store, post: async () => ({ status: "posted", xPostId: "x" }) });
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_pending for an already-posted or dismissed draft", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");
    await store.dismissDraft(inserted.item.id);

    const result = await approveOutreachDraft(inserted.item.id, {
      env: FULL_CREDS,
      store,
      post: async () => ({ status: "posted", xPostId: "x" }),
    });
    expect(result).toEqual({ status: "not_pending" });
  });

  it("marks the item posted with the returned post id on success", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const result = await approveOutreachDraft(inserted.item.id, {
      env: FULL_CREDS,
      store,
      post: async () => ({ status: "posted", xPostId: "x-post-99" }),
    });
    expect(result.status).toBe("posted");
    if (result.status === "posted") {
      expect(result.item.status).toBe("posted");
      expect(result.item.xPostId).toBe("x-post-99");
    }
  });

  it("marks the item failed with an error string on a 429 rate limit, never throwing", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const result = await approveOutreachDraft(inserted.item.id, {
      env: FULL_CREDS,
      store,
      post: async () => ({ status: "rate_limited", message: "X API rate limit reached (429)." }),
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.item.status).toBe("failed");
      expect(result.item.errorMessage).toContain("rate limit");
      expect(result.message).toContain("rate limit");
    }
  });

  it("marks the item failed on an X API error response, never throwing", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const result = await approveOutreachDraft(inserted.item.id, {
      env: FULL_CREDS,
      store,
      post: async () => ({ status: "api_error", httpStatus: 400, message: "bad request" }),
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.item.errorMessage).toContain("400");
      expect(result.item.errorMessage).toContain("bad request");
    }
  });
});
