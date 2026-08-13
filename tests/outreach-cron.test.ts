import { describe, expect, it } from "vitest";
import { runOutreachCron } from "@/lib/server/outreach-cron";
import type { GraduatingFeedResult, GraduatingToken } from "@/lib/server/pumpfun-graduating";
import { createMemoryOutreachStore } from "./outreach-test-helpers";

function token(overrides: Partial<GraduatingToken> = {}): GraduatingToken {
  return {
    name: "Doggo",
    ticker: "DOGGO",
    address: "Mint1",
    artworkUrl: "https://example.com/art.png",
    progressPercent: 91,
    url: "https://pump.fun/coin/Mint1",
    creatorXHandle: null,
    ...overrides,
  };
}

function feed(tokens: GraduatingToken[], error = false): GraduatingFeedResult {
  return { tokens, error };
}

describe("runOutreachCron — dormant state (OUTREACH_QUEUE_ENABLED)", () => {
  it("no-ops entirely — no feed read, no store call — when the flag is unset", async () => {
    let fetchCalled = false;
    const store = createMemoryOutreachStore();
    const originalInsert = store.insertDraftIfEligible.bind(store);
    let storeCalled = false;
    store.insertDraftIfEligible = async (...args) => {
      storeCalled = true;
      return originalInsert(...args);
    };

    const result = await runOutreachCron({
      env: {},
      fetchGraduating: async () => {
        fetchCalled = true;
        return feed([token()]);
      },
      store,
    });

    expect(result.enabled).toBe(false);
    expect(fetchCalled).toBe(false);
    expect(storeCalled).toBe(false);
  });

  it("no-ops when the flag is set to something other than exactly 'true'", async () => {
    let fetchCalled = false;
    const result = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "TRUE" },
      fetchGraduating: async () => {
        fetchCalled = true;
        return feed([]);
      },
      store: createMemoryOutreachStore(),
    });
    expect(result.enabled).toBe(false);
    expect(fetchCalled).toBe(false);
  });
});

describe("runOutreachCron — enabled", () => {
  it("drafts a first-touch item per graduating token, deduped and capped by the store", async () => {
    const store = createMemoryOutreachStore();
    const result = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([token({ address: "Mint1" }), token({ address: "Mint2", ticker: "PUP" })]),
      store,
      random: () => 0,
    });

    expect(result.enabled).toBe(true);
    expect(result.feedError).toBe(false);
    expect(result.firstTouchDrafted).toBe(2);
    const pending = await store.listItems("pending");
    expect(pending).toHaveLength(2);
    expect(pending.every((item) => item.body.includes("@hoodlumsdev"))).toBe(true);
  });

  it("never redrafts a mint that already has a first-touch row (even across separate cron runs)", async () => {
    const store = createMemoryOutreachStore();
    await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([token({ address: "Mint1" })]),
      store,
    });
    const second = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([token({ address: "Mint1" })]),
      store,
    });
    expect(second.firstTouchDrafted).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(await store.listItems("all")).toHaveLength(1);
  });

  it("skips follow-up detection entirely on a feed error (inconclusive, not evidence of graduation)", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(
      {
        touch: "first",
        tokenMint: "Mint1",
        tokenName: "Doggo",
        tokenTicker: "DOGGO",
        tokenArtworkUrl: "",
        tokenUrl: "https://pump.fun/coin/Mint1",
        progressPercent: 97,
        creatorXHandle: null,
        templateKey: "first-board-doesnt-lie",
        body: "congrats @hoodlumsdev $DOGGO",
      },
      10,
    );
    if (inserted.status !== "inserted") throw new Error("expected inserted");
    await store.markPosted(inserted.item.id, "x-post-1");

    const result = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([], true),
      store,
    });
    expect(result.feedError).toBe(true);
    expect(result.followUpDrafted).toBe(0);
  });

  it("drafts a one-time follow-up for a posted mint that was seen at >=95% and has since left the feed", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(
      {
        touch: "first",
        tokenMint: "Mint1",
        tokenName: "Doggo",
        tokenTicker: "DOGGO",
        tokenArtworkUrl: "",
        tokenUrl: "https://pump.fun/coin/Mint1",
        progressPercent: 97,
        creatorXHandle: "doggocreator",
        templateKey: "first-board-doesnt-lie",
        body: "congrats @hoodlumsdev $DOGGO",
      },
      10,
    );
    if (inserted.status !== "inserted") throw new Error("expected inserted");
    await store.markPosted(inserted.item.id, "x-post-1");

    // Mint1 has graduated off the feed; a different token is currently showing.
    const result = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([token({ address: "Mint2", ticker: "PUP" })]),
      store,
    });

    expect(result.followUpDrafted).toBe(1);
    const followUps = (await store.listItems("pending")).filter((item) => item.touch === "followup");
    expect(followUps).toHaveLength(1);
    expect(followUps[0].tokenMint).toBe("Mint1");
    expect(followUps[0].creatorXHandle).toBe("doggocreator");
    expect(followUps[0].body).toContain("@hoodlumsdev");

    // Running again does not draft a second follow-up for the same mint.
    const again = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([token({ address: "Mint2", ticker: "PUP" })]),
      store,
    });
    expect(again.followUpDrafted).toBe(0);
  });

  it("does not follow up on a posted mint still visible in the current feed", async () => {
    const store = createMemoryOutreachStore();
    const inserted = await store.insertDraftIfEligible(
      {
        touch: "first",
        tokenMint: "Mint1",
        tokenName: "Doggo",
        tokenTicker: "DOGGO",
        tokenArtworkUrl: "",
        tokenUrl: "https://pump.fun/coin/Mint1",
        progressPercent: 97,
        creatorXHandle: null,
        templateKey: "first-board-doesnt-lie",
        body: "congrats @hoodlumsdev $DOGGO",
      },
      10,
    );
    if (inserted.status !== "inserted") throw new Error("expected inserted");
    await store.markPosted(inserted.item.id, "x-post-1");

    const result = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([token({ address: "Mint1", progressPercent: 98 })]),
      store,
    });
    expect(result.followUpDrafted).toBe(0);
  });

  it("stops drafting once the shared daily cap is reached and reports skippedCapReached", async () => {
    const store = createMemoryOutreachStore();
    const tokens = Array.from({ length: 12 }, (_, i) => token({ address: `Mint${i}`, ticker: `T${i}` }));
    const result = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed(tokens),
      store,
    });
    expect(result.firstTouchDrafted).toBe(10);
    expect(result.skippedCapReached).toBe(true);
    expect(await store.countDraftsInsertedToday()).toBe(10);
  });

  it("never throws when the store rejects unexpectedly — fail-safe contract", async () => {
    const store = createMemoryOutreachStore();
    store.insertDraftIfEligible = async () => {
      throw new Error("db exploded");
    };
    const result = await runOutreachCron({
      env: { OUTREACH_QUEUE_ENABLED: "true" },
      fetchGraduating: async () => feed([token()]),
      store,
    });
    expect(result.error).toContain("db exploded");
  });
});
