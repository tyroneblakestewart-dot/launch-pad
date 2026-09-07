import { describe, expect, it } from "vitest";
import { approveOutreachDraft } from "@/lib/server/outreach-approve";
import type { GraduatingFeedResult, GraduatingToken } from "@/lib/server/pumpfun-graduating";
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

function graduatingToken(overrides: Partial<GraduatingToken> = {}): GraduatingToken {
  return {
    name: "Doggo",
    ticker: "DOGGO",
    address: "Mint1",
    artworkUrl: "",
    progressPercent: 80,
    url: "https://pump.fun/coin/Mint1",
    creatorXHandle: null,
    ...overrides,
  };
}

/** The mint has left the feed entirely — the same "still bonding vs. graduated" signal the cron's own follow-up detection uses. */
function graduatedFeed(): GraduatingFeedResult {
  return { tokens: [], error: false };
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
      fetchGraduating: async () => graduatedFeed(),
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
      fetchGraduating: async () => graduatedFeed(),
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
      fetchGraduating: async () => graduatedFeed(),
      post: async () => ({ status: "api_error", httpStatus: 400, message: "bad request" }),
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.item.errorMessage).toContain("400");
      expect(result.item.errorMessage).toContain("bad request");
    }
  });
});

/**
 * Owner requirement, 7 Sep 2026: a first-touch draft is created early
 * (75%+ progress, issue #550) so there's something ready for admin review,
 * but the congratulations must never actually post before the token has
 * really graduated. Approval re-checks the live feed itself, not just the
 * progress percent snapshotted at draft time.
 */
describe("approveOutreachDraft — never posts before the token has actually graduated", () => {
  it("refuses to post (and never calls the store's mark-failed path) while the mint is still shown bonding in the current feed", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    let postCalled = false;
    const result = await approveOutreachDraft(inserted.item.id, {
      env: FULL_CREDS,
      store,
      fetchGraduating: async () => ({ tokens: [graduatingToken({ address: "Mint1", progressPercent: 82 })], error: false }),
      post: async () => {
        postCalled = true;
        return { status: "posted", xPostId: "x" };
      },
    });

    expect(result.status).toBe("not_graduated");
    if (result.status === "not_graduated") {
      expect(result.reason).toContain("hasn't graduated yet");
    }
    expect(postCalled).toBe(false);
    // The draft stays pending — this isn't a posting failure, it's just not time yet.
    const stored = await store.getItem(inserted.item.id);
    expect(stored?.status).toBe("pending");
  });

  it("refuses to post when the graduating feed itself errors — inconclusive, not evidence of graduation", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    let postCalled = false;
    const result = await approveOutreachDraft(inserted.item.id, {
      env: FULL_CREDS,
      store,
      fetchGraduating: async () => ({ tokens: [], error: true }),
      post: async () => {
        postCalled = true;
        return { status: "posted", xPostId: "x" };
      },
    });

    expect(result.status).toBe("not_graduated");
    expect(postCalled).toBe(false);
  });

  it("posts once the mint has left the feed entirely (graduated)", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft({ tokenMint: "Mint1" }), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const result = await approveOutreachDraft(inserted.item.id, {
      env: FULL_CREDS,
      store,
      // A different mint is still bonding; Mint1 itself is no longer present.
      fetchGraduating: async () => ({ tokens: [graduatingToken({ address: "Mint2" })], error: false }),
      post: async () => ({ status: "posted", xPostId: "x-post-1" }),
    });

    expect(result.status).toBe("posted");
  });
});
