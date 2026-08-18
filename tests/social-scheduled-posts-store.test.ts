import { afterEach, describe, expect, it } from "vitest";
import {
  computeRolledUpPostStatus,
  getSocialScheduledPostsStore,
  resetSocialScheduledPostsStoreForTests,
  SENDING_CLAIM_STALE_MS,
  SocialScheduledPostsStoreUnavailableError,
} from "@/lib/server/social-scheduled-posts-store";
import { createMemorySocialScheduledPostsStore } from "./social-scheduled-posts-test-helpers";

afterEach(() => {
  resetSocialScheduledPostsStoreForTests();
  delete process.env.DATABASE_URL;
});

describe("unconfigured scheduled posts store (no DATABASE_URL)", () => {
  it("fails safe on read paths without throwing, and throws only on the create path", async () => {
    delete process.env.DATABASE_URL;
    const store = getSocialScheduledPostsStore();

    await expect(store.list("0xabc")).resolves.toEqual([]);
    await expect(store.get("id")).resolves.toBeNull();
    await expect(store.cancel("id", "0xabc")).resolves.toEqual({ status: "not_found" });
    await expect(store.listDueDestinations(new Date(), 10)).resolves.toEqual([]);
    await expect(store.markDestinationSent("id", "ext", new Date())).resolves.toBeUndefined();
    await expect(store.markDestinationRetry("id", "err", new Date())).resolves.toBeUndefined();
    await expect(store.markDestinationFailedFinal("id", "err")).resolves.toBeUndefined();
    await expect(store.recomputePostStatus("id")).resolves.toBeUndefined();

    await expect(
      store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: new Date(), approvedByWallet: "0xabc" }),
    ).rejects.toBeInstanceOf(SocialScheduledPostsStoreUnavailableError);
  });
});

describe("approval-is-creation state machine", () => {
  it("creates a post already in the scheduled state, with one destination row per requested platform", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const post = await store.create({
      walletAddress: "0xabc",
      body: "gm hoodlums",
      artworkDataUrl: null,
      destinations: ["x", "telegram"],
      scheduledAt: new Date(),
      approvedByWallet: "0xabc",
    });
    expect(post.status).toBe("scheduled");
    expect(post.approvedByWallet).toBe("0xabc");
    expect(post.destinations.map((d) => d.platform).sort()).toEqual(["telegram", "x"]);
    expect(post.destinations.every((d) => d.status === "pending")).toBe(true);
  });

  it("cancel only succeeds while still scheduled", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const post = await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: new Date(), approvedByWallet: "0xabc" });

    const wrongWallet = await store.cancel(post.id, "0xdef");
    expect(wrongWallet.status).toBe("not_found");

    const canceled = await store.cancel(post.id, "0xabc");
    expect(canceled).toEqual({ status: "canceled" });

    const alreadyCanceled = await store.cancel(post.id, "0xabc");
    expect(alreadyCanceled).toEqual({ status: "not_cancelable" });
  });

  it("listDueDestinations only returns pending destinations at or past their next_attempt_at, for scheduled posts", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-01-01T01:00:00Z");
    const past = new Date("2025-12-31T23:00:00Z");

    const duePost = await store.create({ walletAddress: "0xabc", body: "due", artworkDataUrl: null, destinations: ["x"], scheduledAt: past, approvedByWallet: "0xabc" });
    await store.create({ walletAddress: "0xabc", body: "not due yet", artworkDataUrl: null, destinations: ["x"], scheduledAt: future, approvedByWallet: "0xabc" });
    const canceledPost = await store.create({ walletAddress: "0xabc", body: "canceled", artworkDataUrl: null, destinations: ["x"], scheduledAt: past, approvedByWallet: "0xabc" });
    await store.cancel(canceledPost.id, "0xabc");

    const due = await store.listDueDestinations(now, 10);
    expect(due).toHaveLength(1);
    expect(due[0].scheduledPostId).toBe(duePost.id);
  });

  it("recomputePostStatus rolls the post up to sent only once every destination has sent", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const post = await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x", "telegram"], scheduledAt: new Date(), approvedByWallet: "0xabc" });
    const [xDestination, telegramDestination] = post.destinations;

    await store.markDestinationSent(xDestination.id, "x-post-1", new Date());
    await store.recomputePostStatus(post.id);
    expect((await store.get(post.id))?.status).toBe("scheduled");

    await store.markDestinationSent(telegramDestination.id, "42", new Date());
    await store.recomputePostStatus(post.id);
    expect((await store.get(post.id))?.status).toBe("sent");
  });

  it("recomputePostStatus rolls up to partially_sent when destinations disagree, and failed when all fail", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const mixed = await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x", "telegram"], scheduledAt: new Date(), approvedByWallet: "0xabc" });
    await store.markDestinationSent(mixed.destinations[0].id, "x-1", new Date());
    await store.markDestinationFailedFinal(mixed.destinations[1].id, "telegram down");
    await store.recomputePostStatus(mixed.id);
    expect((await store.get(mixed.id))?.status).toBe("partially_sent");

    const failed = await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: new Date(), approvedByWallet: "0xabc" });
    await store.markDestinationFailedFinal(failed.destinations[0].id, "x down");
    await store.recomputePostStatus(failed.id);
    expect((await store.get(failed.id))?.status).toBe("failed");
  });
});

describe("claim-before-send locking (issue #377)", () => {
  it("claims a due destination to 'sending' and excludes it from an immediate second call", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const now = new Date("2026-01-01T00:00:00Z");
    const post = await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: now, approvedByWallet: "0xabc" });

    const firstClaim = await store.listDueDestinations(now, 10);
    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0].scheduledPostId).toBe(post.id);

    const secondClaim = await store.listDueDestinations(now, 10);
    expect(secondClaim).toHaveLength(0);

    expect((await store.get(post.id))?.destinations[0].status).toBe("sending");
  });

  it("does not reclaim a 'sending' destination before SENDING_CLAIM_STALE_MS has passed", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const now = new Date("2026-01-01T00:00:00Z");
    await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: now, approvedByWallet: "0xabc" });

    await store.listDueDestinations(now, 10);
    const stillClaimed = await store.listDueDestinations(new Date(now.getTime() + SENDING_CLAIM_STALE_MS - 1000), 10);
    expect(stillClaimed).toHaveLength(0);
  });

  it("reclaims a destination stuck in 'sending' once SENDING_CLAIM_STALE_MS has passed — recovery for a crashed run", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const now = new Date("2026-01-01T00:00:00Z");
    await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: now, approvedByWallet: "0xabc" });

    await store.listDueDestinations(now, 10);
    const reclaimed = await store.listDueDestinations(new Date(now.getTime() + SENDING_CLAIM_STALE_MS + 1000), 10);
    expect(reclaimed).toHaveLength(1);
  });

  it("markDestinationRetry resets a claimed destination back to 'pending' so it becomes due again", async () => {
    const store = createMemorySocialScheduledPostsStore();
    const now = new Date("2026-01-01T00:00:00Z");
    const post = await store.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: now, approvedByWallet: "0xabc" });

    await store.listDueDestinations(now, 10);
    await store.markDestinationRetry(post.destinations[0].id, "transient error", new Date(now.getTime() + 60_000));

    expect((await store.get(post.id))?.destinations[0].status).toBe("pending");
  });
});

describe("computeRolledUpPostStatus treats 'sending' as not-done (issue #377)", () => {
  it("returns null while any destination is 'sending', the same as 'pending'", () => {
    expect(computeRolledUpPostStatus(["sending"])).toBeNull();
    expect(computeRolledUpPostStatus(["sent", "sending"])).toBeNull();
    expect(computeRolledUpPostStatus(["sent", "sent"])).toBe("sent");
  });
});
