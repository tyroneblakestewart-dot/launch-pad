import { describe, expect, it, vi } from "vitest";
import {
  CONNECTION_RECONNECT_FAILURE_THRESHOLD,
  LINK_POST_COMPOSER_REASON,
  MAX_DESTINATION_ATTEMPTS,
  MONTHLY_COST_CAP_REASON,
  computeRetryBackoffSeconds,
  runSocialPostingCron,
} from "@/lib/server/social-posting-cron";
import { createMemorySocialConnectionsStore } from "./social-connections-test-helpers";
import { createMemorySocialScheduledPostsStore } from "./social-scheduled-posts-test-helpers";
import { createMemorySocialXCostStore } from "./social-x-cost-test-helpers";

const ENV = { X_SOCIAL_CONSUMER_KEY: "ck", X_SOCIAL_CONSUMER_SECRET: "cs", TELEGRAM_BOT_TOKEN: "12345:token-aaaaaaaaaaaaaaaaaaaa" };
const NOW = new Date("2026-01-01T00:00:00Z");

async function seedConnectedX(connectionsStore: ReturnType<typeof createMemorySocialConnectionsStore>, wallet = "0xabc") {
  await connectionsStore.upsert({
    walletAddress: wallet,
    platform: "x",
    displayName: "@hoodlumsdev",
    externalId: "1",
    credentials: JSON.stringify({ accessToken: "at", accessSecret: "as" }),
  });
}

async function seedConnectedTelegram(connectionsStore: ReturnType<typeof createMemorySocialConnectionsStore>, wallet = "0xabc") {
  await connectionsStore.upsert({
    walletAddress: wallet,
    platform: "telegram",
    displayName: "Hoodlums Announcements",
    externalId: "@hoodlums",
    credentials: JSON.stringify({ chatId: "@hoodlums" }),
  });
}

describe("computeRetryBackoffSeconds", () => {
  it("doubles from a 60s base for each successive attempt", () => {
    expect(computeRetryBackoffSeconds(0)).toBe(60);
    expect(computeRetryBackoffSeconds(1)).toBe(120);
    expect(computeRetryBackoffSeconds(2)).toBe(240);
  });
});

describe("runSocialPostingCron: no-op / fail-safe cases", () => {
  it("is a true no-op when nothing is due", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    const result = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore });
    expect(result).toMatchObject({ processed: 0, sent: 0, retried: 0, failed: 0, error: null });
  });

  it("never throws even if the store rejects — returns an error result", async () => {
    const brokenStore = createMemorySocialScheduledPostsStore();
    brokenStore.listDueDestinations = async () => {
      throw new Error("db exploded");
    };
    const result = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore: brokenStore, connectionsStore: createMemorySocialConnectionsStore() });
    expect(result.error).toContain("db exploded");
  });
});

describe("runSocialPostingCron: durable heartbeat", () => {
  it("records start and successful completion even when the queue is empty", async () => {
    const started: Date[] = [];
    const completed: Array<{ result: { error: string | null; processed: number }; at: Date }> = [];

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore: createMemorySocialScheduledPostsStore(),
      connectionsStore: createMemorySocialConnectionsStore(),
      heartbeatRecorder: {
        markStarted: async (at) => {
          started.push(at);
        },
        markCompleted: async (heartbeatResult, at) => {
          completed.push({ result: heartbeatResult, at });
        },
      },
    });

    expect(result).toMatchObject({ processed: 0, error: null });
    expect(started).toEqual([NOW]);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ result: { processed: 0, error: null }, at: NOW });
  });

  it("records a failed completion when queue storage rejects", async () => {
    const brokenStore = createMemorySocialScheduledPostsStore();
    brokenStore.listDueDestinations = async () => {
      throw new Error("db exploded");
    };
    const completed: Array<{ error: string | null }> = [];

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore: brokenStore,
      connectionsStore: createMemorySocialConnectionsStore(),
      heartbeatRecorder: {
        markStarted: async () => undefined,
        markCompleted: async (heartbeatResult) => {
          completed.push(heartbeatResult);
        },
      },
    });

    expect(result.error).toContain("db exploded");
    expect(completed[0]?.error).toContain("db exploded");
  });

  it("never changes the cron result when heartbeat storage itself is unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await runSocialPostingCron({
        env: ENV,
        now: NOW,
        scheduledPostsStore: createMemorySocialScheduledPostsStore(),
        connectionsStore: createMemorySocialConnectionsStore(),
        heartbeatRecorder: {
          markStarted: async () => {
            throw new Error("heartbeat table unavailable");
          },
          markCompleted: async () => {
            throw new Error("heartbeat table unavailable");
          },
        },
      });

      expect(result).toMatchObject({ processed: 0, error: null });
      expect(consoleError).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("runSocialPostingCron: X destination", () => {
  it("marks a destination sent and resets the connection's failure count on success", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await connectionsStore.recordFailure("0xabc", "x", "earlier blip", 100);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser: async () => ({ status: "posted", xPostId: "999" }),
    });

    expect(result).toMatchObject({ processed: 1, sent: 1, retried: 0, failed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("sent");
    expect(post.destinations[0]).toMatchObject({ status: "sent", externalPostId: "999" });
    expect((await connectionsStore.get("0xabc", "x"))?.failureCount).toBe(0);
  });

  it("keeps the destination sent, without retry or duplicate send, when costStore.recordSend throws (issue #368)", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const postTweetForUser = vi.fn(async () => ({ status: "posted" as const, xPostId: "999" }));
    const brokenCostStore = createMemorySocialXCostStore();
    brokenCostStore.recordSend = async () => {
      throw new Error("db exploded");
    };

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      costStore: brokenCostStore,
      postTweetForUser,
    });

    expect(result).toMatchObject({ processed: 1, sent: 1, retried: 0, failed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("sent");
    expect(post.destinations[0]).toMatchObject({ status: "sent", externalPostId: "999" });
    expect(postTweetForUser).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential backoff on a transient API error, without exhausting attempts", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser: async () => ({ status: "api_error", httpStatus: 500, message: "server error" }),
    });

    expect(result).toMatchObject({ retried: 1, sent: 0, failed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("scheduled");
    expect(post.destinations[0].status).toBe("pending");
    expect(post.destinations[0].attemptCount).toBe(1);
    expect(new Date(post.destinations[0].nextAttemptAt).getTime()).toBe(NOW.getTime() + 60_000);
  });

  it("marks the destination permanently failed once MAX_DESTINATION_ATTEMPTS is reached", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    let lastResult;
    let now = NOW;
    for (let attempt = 0; attempt < MAX_DESTINATION_ATTEMPTS; attempt++) {
      lastResult = await runSocialPostingCron({
        env: ENV,
        now,
        scheduledPostsStore,
        connectionsStore,
        postTweetForUser: async () => ({ status: "api_error", httpStatus: 500, message: "server error" }),
      });
      // Isolates per-destination attempt exhaustion from the connection-level
      // reconnect_needed threshold (covered separately below) by simulating
      // other posts on the same connection succeeding in between — CONNECTION_RECONNECT_FAILURE_THRESHOLD
      // is deliberately lower than MAX_DESTINATION_ATTEMPTS, so without this a
      // single repeatedly-failing post would pause the whole connection first.
      await connectionsStore.resetFailures("0xabc", "x");
      now = new Date(now.getTime() + computeRetryBackoffSeconds(attempt) * 1000 + 1000);
    }

    expect(lastResult).toMatchObject({ failed: 1 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("failed");
    expect(post.destinations[0].status).toBe("failed");
  });

  it("flips the connection to reconnect_needed on a 401/403 (revoked token) and pauses the post instead of failing it", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser: async () => ({ status: "api_error", httpStatus: 401, message: "unauthorized" }),
    });

    expect(result).toMatchObject({ retried: 1, failed: 0 });
    const connection = await connectionsStore.get("0xabc", "x");
    expect(connection?.status).toBe("reconnect_needed");
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("scheduled");
    expect(post.destinations[0].status).toBe("pending");
    // Paused destinations get a long backoff (not the fast exponential retry), so they don't hot-loop while unreachable.
    expect(new Date(post.destinations[0].nextAttemptAt).getTime()).toBe(NOW.getTime() + 60 * 60 * 1000);
  });

  it("pauses (does not send) when the connection is already reconnect_needed", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await connectionsStore.markReconnectNeeded("0xabc", "x", "revoked earlier");
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    let called = false;
    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser: async () => {
        called = true;
        return { status: "posted", xPostId: "should-not-happen" };
      },
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({ retried: 1, sent: 0 });
  });

  it("pauses with no connection on file at all (never throws)", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore });
    expect(result).toMatchObject({ retried: 1, sent: 0, failed: 0 });
  });

  it("fails closed (pauses, never reaches the network) when X_SOCIAL_* is unset — uses the real postTweetForUser, not a stub", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    // No postTweetForUser override: the real implementation's own env check must be what fails closed here.
    const result = await runSocialPostingCron({
      env: { TELEGRAM_BOT_TOKEN: ENV.TELEGRAM_BOT_TOKEN },
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
    });
    expect(result).toMatchObject({ retried: 1, sent: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0].status).toBe("pending");
  });

  it("reaches reconnect_needed after CONNECTION_RECONNECT_FAILURE_THRESHOLD ordinary failures, before MAX_DESTINATION_ATTEMPTS is hit", async () => {
    expect(CONNECTION_RECONNECT_FAILURE_THRESHOLD).toBeLessThan(MAX_DESTINATION_ATTEMPTS);
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    // Advance `now` past each retry's backoff so the same destination becomes due again on the next run.
    let now = NOW;
    for (let i = 0; i < CONNECTION_RECONNECT_FAILURE_THRESHOLD; i++) {
      await runSocialPostingCron({
        env: ENV,
        now,
        scheduledPostsStore,
        connectionsStore,
        postTweetForUser: async () => ({ status: "network_error", message: "flaky" }),
      });
      now = new Date(now.getTime() + computeRetryBackoffSeconds(i) * 1000 + 1000);
    }

    expect((await connectionsStore.get("0xabc", "x"))?.status).toBe("reconnect_needed");
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0].status).toBe("pending");
  });
});

describe("runSocialPostingCron: Telegram destination", () => {
  it("marks a destination sent using the connected channel", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      publishTelegramPost: async () => [42],
    });

    expect(result).toMatchObject({ sent: 1 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0]).toMatchObject({ status: "sent", externalPostId: "42" });
  });

  it("flips the connection to reconnect_needed when the bot was removed from the channel", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      publishTelegramPost: async () => {
        throw new Error("Forbidden: bot was kicked from the channel chat");
      },
    });

    expect((await connectionsStore.get("0xabc", "telegram"))?.status).toBe("reconnect_needed");
  });

  it("retries on an ordinary Telegram error instead of pausing immediately", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      publishTelegramPost: async () => {
        throw new Error("Telegram API timed out");
      },
    });

    expect(result).toMatchObject({ retried: 1 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(new Date(post.destinations[0].nextAttemptAt).getTime()).toBe(NOW.getTime() + 60_000);
  });

  it("fails closed (never calls the Telegram client) when TELEGRAM_BOT_TOKEN is unset", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    let called = false;
    const result = await runSocialPostingCron({
      env: { X_SOCIAL_CONSUMER_KEY: ENV.X_SOCIAL_CONSUMER_KEY, X_SOCIAL_CONSUMER_SECRET: ENV.X_SOCIAL_CONSUMER_SECRET },
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      publishTelegramPost: async () => {
        called = true;
        return [1];
      },
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({ retried: 1 });
  });
});

describe("runSocialPostingCron: content filter final check (issue #392)", () => {
  it("marks a poisoned pre-existing X destination permanently failed on the first attempt, never sending and never retrying", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    // Simulates a body approved before the filter existed.
    await scheduledPostsStore.create({
      walletAddress: "0xabc",
      body: "This nigger coin is pumping right now.",
      artworkDataUrl: null,
      destinations: ["x"],
      scheduledAt: NOW,
      approvedByWallet: "0xabc",
    });

    const postTweetForUser = vi.fn(async () => ({ status: "posted" as const, xPostId: "999" }));
    const result = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, postTweetForUser });

    expect(result).toMatchObject({ processed: 1, sent: 0, retried: 0, failed: 1 });
    expect(postTweetForUser).not.toHaveBeenCalled();
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("failed");
    expect(post.destinations[0]).toMatchObject({ status: "failed" });
    expect(post.destinations[0].errorMessage).toContain("content safety filter");
  });

  it("marks a poisoned pre-existing Telegram destination permanently failed without calling the Telegram client", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({
      walletAddress: "0xabc",
      body: "Come hang with the kike crew.",
      artworkDataUrl: null,
      destinations: ["telegram"],
      scheduledAt: NOW,
      approvedByWallet: "0xabc",
    });

    const publishTelegramPost = vi.fn(async () => [1]);
    const result = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost });

    expect(result).toMatchObject({ processed: 1, sent: 0, retried: 0, failed: 1 });
    expect(publishTelegramPost).not.toHaveBeenCalled();
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0]).toMatchObject({ status: "failed" });
  });

  it("passes a clean body straight through to send", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm degenerates, fuck the bear market", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser: async () => ({ status: "posted", xPostId: "999" }),
    });

    expect(result).toMatchObject({ sent: 1, failed: 0 });
  });

  it("fails closed and treats the destination as filtered when the content-filter dependency itself throws", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const postTweetForUser = vi.fn(async () => ({ status: "posted" as const, xPostId: "999" }));
    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser,
      contentFilterCheck: () => {
        throw new Error("filter boom");
      },
    });

    expect(postTweetForUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1, sent: 0 });
  });
});

describe("runSocialPostingCron: multi-destination independence", () => {
  it("sends X and lets Telegram fail independently, rolling the post up to partially_sent", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x", "telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    let attempt = 0;
    let now = NOW;
    for (let i = 0; i < MAX_DESTINATION_ATTEMPTS; i++) {
      attempt += 1;
      await runSocialPostingCron({
        env: ENV,
        now,
        scheduledPostsStore,
        connectionsStore,
        postTweetForUser: async () => ({ status: "posted", xPostId: `x-${attempt}` }),
        publishTelegramPost: async () => {
          throw new Error("Telegram down");
        },
      });
      // See the comment in the MAX_DESTINATION_ATTEMPTS test above — isolates
      // this destination's own attempt exhaustion from the connection-level
      // reconnect_needed threshold, which is lower and would otherwise pause
      // Telegram indefinitely instead of letting it reach "failed".
      await connectionsStore.resetFailures("0xabc", "telegram");
      now = new Date(now.getTime() + computeRetryBackoffSeconds(i) * 1000 + 1000);
    }

    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("partially_sent");
    const x = post.destinations.find((d) => d.platform === "x");
    const telegram = post.destinations.find((d) => d.platform === "telegram");
    expect(x?.status).toBe("sent");
    expect(telegram?.status).toBe("failed");
  });
});

describe("runSocialPostingCron: link posts never reach the X API (issue #342)", () => {
  it("routes a link-bearing X post to the composer instead of calling the X API", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({
      walletAddress: "0xabc",
      body: "come check out hoodlums.dev",
      artworkDataUrl: null,
      destinations: ["x"],
      scheduledAt: NOW,
      approvedByWallet: "0xabc",
    });

    let called = false;
    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser: async () => {
        called = true;
        return { status: "posted", xPostId: "should-not-happen" };
      },
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({ routedToComposer: 1, sent: 0, retried: 0, failed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.status).toBe("needs_composer");
    expect(post.destinations[0]).toMatchObject({ status: "needs_composer", errorMessage: LINK_POST_COMPOSER_REASON });
  });

  it("does not touch the connection's failure state when routing to the composer", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "link: bit.ly/hoodlums", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore });

    expect((await connectionsStore.get("0xabc", "x"))?.status).toBe("connected");
    expect((await connectionsStore.get("0xabc", "x"))?.failureCount).toBe(0);
  });

  it("never routes a Telegram destination to the composer, even with a link — a mixed post sends Telegram and routes X independently", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({
      walletAddress: "0xabc",
      body: "come check out hoodlums.dev",
      artworkDataUrl: null,
      destinations: ["x", "telegram"],
      scheduledAt: NOW,
      approvedByWallet: "0xabc",
    });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      publishTelegramPost: async () => [7],
    });

    expect(result).toMatchObject({ sent: 1, routedToComposer: 1 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    const x = post.destinations.find((d) => d.platform === "x");
    const telegram = post.destinations.find((d) => d.platform === "telegram");
    expect(x?.status).toBe("needs_composer");
    expect(telegram?.status).toBe("sent");
    expect(post.status).toBe("needs_composer");
  });

  it("does not flag plain text with no link — sends normally through the X API", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm hoodlums, $HOOD up 12.5% today", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const result = await runSocialPostingCron({
      env: ENV,
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      postTweetForUser: async () => ({ status: "posted", xPostId: "1" }),
    });

    expect(result).toMatchObject({ sent: 1, routedToComposer: 0 });
  });
});

describe("runSocialPostingCron: bookkeeping failures never re-trigger a send (issue #377)", () => {
  it("keeps an X destination 'sent' with no retry or connection-failure bump when markDestinationSent throws after a successful post", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await connectionsStore.recordFailure("0xabc", "x", "earlier blip", 2);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const realMarkDestinationSent = scheduledPostsStore.markDestinationSent.bind(scheduledPostsStore);
    scheduledPostsStore.markDestinationSent = async (...args) => {
      // The write actually commits, but the client never sees the
      // acknowledgment — exactly the ambiguous-outcome failure #375's
      // single-connection pool made more likely.
      await realMarkDestinationSent(...args);
      throw new Error("connection terminated while acknowledging the write");
    };

    const postTweetForUser = vi.fn(async () => ({ status: "posted" as const, xPostId: "999" }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, postTweetForUser });
    const second = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, postTweetForUser });

    consoleError.mockRestore();

    expect(postTweetForUser).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ processed: 1, sent: 1, retried: 0, failed: 0 });
    expect(second).toMatchObject({ processed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0]).toMatchObject({ status: "sent", externalPostId: "999" });
    expect((await connectionsStore.get("0xabc", "x"))?.failureCount).toBe(0);
  });

  it("keeps an X destination 'sent' with no retry or connection-failure bump when resetFailures throws after a successful post", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedX(connectionsStore);
    await connectionsStore.recordFailure("0xabc", "x", "earlier blip", 2);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const realResetFailures = connectionsStore.resetFailures.bind(connectionsStore);
    connectionsStore.resetFailures = async (...args) => {
      await realResetFailures(...args);
      throw new Error("connection terminated while acknowledging the write");
    };

    const postTweetForUser = vi.fn(async () => ({ status: "posted" as const, xPostId: "999" }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, postTweetForUser });
    const second = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, postTweetForUser });

    consoleError.mockRestore();

    expect(postTweetForUser).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ processed: 1, sent: 1, retried: 0, failed: 0 });
    expect(second).toMatchObject({ processed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0]).toMatchObject({ status: "sent", externalPostId: "999" });
    expect((await connectionsStore.get("0xabc", "x"))?.failureCount).toBe(0);
  });

  it("keeps a Telegram destination 'sent' with no retry or connection-failure bump when markDestinationSent throws after a successful publish", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await connectionsStore.recordFailure("0xabc", "telegram", "earlier blip", 2);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const realMarkDestinationSent = scheduledPostsStore.markDestinationSent.bind(scheduledPostsStore);
    scheduledPostsStore.markDestinationSent = async (...args) => {
      await realMarkDestinationSent(...args);
      throw new Error("connection terminated while acknowledging the write");
    };

    const publishTelegramPost = vi.fn(async () => [42]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost });
    const second = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost });

    consoleError.mockRestore();

    expect(publishTelegramPost).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ processed: 1, sent: 1, retried: 0, failed: 0 });
    expect(second).toMatchObject({ processed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0]).toMatchObject({ status: "sent", externalPostId: "42" });
    expect((await connectionsStore.get("0xabc", "telegram"))?.failureCount).toBe(0);
  });

  it("keeps a Telegram destination 'sent' with no retry or connection-failure bump when resetFailures throws after a successful publish", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await connectionsStore.recordFailure("0xabc", "telegram", "earlier blip", 2);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const realResetFailures = connectionsStore.resetFailures.bind(connectionsStore);
    connectionsStore.resetFailures = async (...args) => {
      await realResetFailures(...args);
      throw new Error("connection terminated while acknowledging the write");
    };

    const publishTelegramPost = vi.fn(async () => [42]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost });
    const second = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost });

    consoleError.mockRestore();

    expect(publishTelegramPost).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ processed: 1, sent: 1, retried: 0, failed: 0 });
    expect(second).toMatchObject({ processed: 0 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0]).toMatchObject({ status: "sent", externalPostId: "42" });
    expect((await connectionsStore.get("0xabc", "telegram"))?.failureCount).toBe(0);
  });
});

describe("runSocialPostingCron: per-destination loop isolation (issue #377)", () => {
  it("does not let one destination's unexpected throw block the rest of the batch or skip recomputePostStatus", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore, "0xbroken");
    await seedConnectedTelegram(connectionsStore, "0xok");
    await scheduledPostsStore.create({ walletAddress: "0xbroken", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xbroken" });
    await scheduledPostsStore.create({ walletAddress: "0xok", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xok" });

    const realGet = connectionsStore.get.bind(connectionsStore);
    connectionsStore.get = async (walletAddress, platform) => {
      if (walletAddress === "0xbroken") throw new Error("unexpected connection lookup failure");
      return realGet(walletAddress, platform);
    };

    const publishTelegramPost = vi.fn(async () => [1]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost });

    consoleError.mockRestore();

    expect(result).toMatchObject({ processed: 2, sent: 1, failed: 1 });
    expect(publishTelegramPost).toHaveBeenCalledTimes(1);

    // recomputePostStatus ran for the surviving post despite the other destination throwing.
    const okPost = (await scheduledPostsStore.list("0xok"))[0];
    expect(okPost.status).toBe("sent");
    // The broken destination stays claimed rather than silently lost — a future run reclaims it once stale.
    const brokenPost = (await scheduledPostsStore.list("0xbroken"))[0];
    expect(brokenPost.destinations[0].status).toBe("sending");
  });
});

describe("runSocialPostingCron: concurrent invocations claim each due row once (issue #377)", () => {
  it("results in exactly one publish across two concurrent cron runs over the same due destination", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    await seedConnectedTelegram(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["telegram"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const publishTelegramPost = vi.fn(async () => [1]);

    const [first, second] = await Promise.all([
      runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost }),
      runSocialPostingCron({ env: ENV, now: NOW, scheduledPostsStore, connectionsStore, publishTelegramPost }),
    ]);

    expect(publishTelegramPost).toHaveBeenCalledTimes(1);
    expect(first.processed + second.processed).toBe(1);
    expect(first.sent + second.sent).toBe(1);
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    expect(post.destinations[0].status).toBe("sent");
  });
});

describe("runSocialPostingCron: monthly X cost cap (issue #342)", () => {
  it("records an estimated cost for each successful X send", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    const costStore = createMemorySocialXCostStore();
    await seedConnectedX(connectionsStore);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    await runSocialPostingCron({
      env: { ...ENV, SOCIAL_X_API_SEND_COST_USD: "0.015" },
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      costStore,
      postTweetForUser: async () => ({ status: "posted", xPostId: "1" }),
    });

    expect(await costStore.monthlyTotalUsd("0xabc", NOW)).toBeCloseTo(0.015, 5);
  });

  it("pauses X sends (does not call the API) once the wallet's monthly cap would be exceeded, while Telegram is unaffected", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    const costStore = createMemorySocialXCostStore();
    await seedConnectedX(connectionsStore);
    await seedConnectedTelegram(connectionsStore);
    await costStore.recordSend("0xabc", "prior-destination", 0.02, NOW);
    await scheduledPostsStore.create({
      walletAddress: "0xabc",
      body: "gm",
      artworkDataUrl: null,
      destinations: ["x", "telegram"],
      scheduledAt: NOW,
      approvedByWallet: "0xabc",
    });

    let xCalled = false;
    const result = await runSocialPostingCron({
      env: { ...ENV, SOCIAL_X_API_SEND_COST_USD: "0.015", SOCIAL_X_MONTHLY_COST_CAP_USD: "0.02" },
      now: NOW,
      scheduledPostsStore,
      connectionsStore,
      costStore,
      postTweetForUser: async () => {
        xCalled = true;
        return { status: "posted", xPostId: "should-not-happen" };
      },
      publishTelegramPost: async () => [1],
    });

    expect(xCalled).toBe(false);
    expect(result).toMatchObject({ sent: 1, retried: 1 });
    const post = (await scheduledPostsStore.list("0xabc"))[0];
    const x = post.destinations.find((d) => d.platform === "x");
    const telegram = post.destinations.find((d) => d.platform === "telegram");
    expect(x?.status).toBe("pending");
    expect(x?.errorMessage).toBe(MONTHLY_COST_CAP_REASON);
    expect(telegram?.status).toBe("sent");
  });

  it("resumes X sends once the cap check is evaluated against a later month", async () => {
    const scheduledPostsStore = createMemorySocialScheduledPostsStore();
    const connectionsStore = createMemorySocialConnectionsStore();
    const costStore = createMemorySocialXCostStore();
    await seedConnectedX(connectionsStore);
    await costStore.recordSend("0xabc", "prior-destination", 0.02, NOW);
    await scheduledPostsStore.create({ walletAddress: "0xabc", body: "gm", artworkDataUrl: null, destinations: ["x"], scheduledAt: NOW, approvedByWallet: "0xabc" });

    const nextMonth = new Date("2026-02-01T00:00:00Z");
    const result = await runSocialPostingCron({
      env: { ...ENV, SOCIAL_X_API_SEND_COST_USD: "0.015", SOCIAL_X_MONTHLY_COST_CAP_USD: "0.02" },
      now: nextMonth,
      scheduledPostsStore,
      connectionsStore,
      costStore,
      postTweetForUser: async () => ({ status: "posted", xPostId: "1" }),
    });

    expect(result).toMatchObject({ sent: 1 });
  });
});
