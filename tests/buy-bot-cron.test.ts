import { describe, expect, it, vi } from "vitest";
import {
  BUY_BOT_JOB_KEY,
  BUY_BOT_RECONNECT_FAILURE_THRESHOLD,
  resolveBuyBotTradesReader,
  runBuyBotCron,
  setBuyBotTradesReaderForTests,
  toHeartbeatResult,
} from "@/lib/server/buy-bot-cron";
import type { TokenLaunch, TokenLaunchesStore } from "@/lib/server/token-launches-store";
import type { TokenTrade } from "@/lib/token-trade-types";
import { BUY_BOT_TEST_CURVE, BUY_BOT_TEST_TOKEN, createMemoryBuyBotStore, makeBuyTrade } from "./buy-bot-test-helpers";

const ENV = { TELEGRAM_BOT_TOKEN: "12345:token-aaaaaaaaaaaaaaaaaaaa" };
const NOW = new Date("2026-09-05T12:00:00Z");
const WALLET = "0x1111111111111111111111111111111111111111";

const LAUNCH: TokenLaunch = {
  id: "launch-1",
  chainId: 46630,
  tokenAddress: BUY_BOT_TEST_TOKEN,
  curveAddress: BUY_BOT_TEST_CURVE,
  creatorWalletAddress: WALLET,
  tokenName: "Hoodlums Test",
  ticker: "HOODS",
  decimals: 18,
  wholeTokenSupply: "1000000000",
  graduationTargetWei: "10000000000000000",
  graduated: false,
  graduatedAt: null,
  launchedAt: "2026-09-01T00:00:00.000Z",
  artworkThumbnail: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
};

function launchesStore(launch: TokenLaunch | null = LAUNCH): TokenLaunchesStore {
  return {
    findByTokenAddress: async () => launch,
  } as unknown as TokenLaunchesStore;
}

async function seedBot(store: ReturnType<typeof createMemoryBuyBotStore>, overrides: { thresholdWei?: string; cursorBlockNumber?: string } = {}) {
  return store.upsert({
    walletAddress: WALLET,
    chainId: 46630,
    tokenAddress: BUY_BOT_TEST_TOKEN,
    curveAddress: BUY_BOT_TEST_CURVE,
    channelDisplayName: "HOODS Buys",
    channelExternalId: "@hoodsbuys",
    channel: JSON.stringify({ chatId: "@hoodsbuys" }),
    thresholdWei: overrides.thresholdWei ?? "10000000000000000",
    cursorBlockNumber: overrides.cursorBlockNumber ?? "1000",
    cursorLogIndex: 0,
  });
}

function trades(...items: TokenTrade[]) {
  return async () => items;
}

describe("runBuyBotCron: no-op / fail-safe cases", () => {
  it("is a true no-op with no active bots", async () => {
    const result = await runBuyBotCron({ env: ENV, now: NOW, store: createMemoryBuyBotStore(), launchesStore: launchesStore(), readTrades: trades() });
    expect(result).toMatchObject({ processed: 0, sent: 0, failed: 0, reconnectNeeded: 0, error: null });
  });

  it("never throws even if the store rejects — returns an error result and still records the heartbeat", async () => {
    const store = createMemoryBuyBotStore();
    store.listActive = async () => {
      throw new Error("db exploded");
    };
    const completed: Array<{ error: string | null }> = [];
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(),
      heartbeatRecorder: {
        markStarted: async () => undefined,
        markCompleted: async (heartbeat) => {
          completed.push({ error: heartbeat.error });
        },
      },
    });
    expect(result.error).toContain("db exploded");
    expect(completed).toEqual([{ error: expect.stringContaining("db exploded") }]);
  });

  it("skips paused and reconnect_needed bots entirely", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    await store.updateSettings(WALLET, 46630, BUY_BOT_TEST_TOKEN, { status: "paused" });
    const publish = vi.fn(async () => [1]);
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(makeBuyTrade({ blockNumber: "1001" })),
      publishTelegramPost: publish,
    });
    expect(result.processed).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("counts a bot as failed but never touches its cursor or status when TELEGRAM_BOT_TOKEN is unset", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const result = await runBuyBotCron({ env: {}, now: NOW, store, launchesStore: launchesStore(), readTrades: trades(makeBuyTrade({ blockNumber: "1001" })) });
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    const bot = await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN);
    expect(bot).toMatchObject({ status: "active", cursorBlockNumber: "1000" });
  });
});

describe("runBuyBotCron: announcing buys", () => {
  it("posts each qualifying buy oldest-first with the launch artwork as the photo, advancing the cursor after every successful send", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const publish = vi.fn(async () => [1]);
    const readProgress = vi.fn(async () => ({ state: "bonding" as const, progressBps: 2500n, raisedWei: 1n, targetWei: 4n, liquidityPool: null }));

    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(
        makeBuyTrade({ blockNumber: "1002", logIndex: 0, grossNativeAmountRaw: "20000000000000000" }),
        makeBuyTrade({ blockNumber: "1001", logIndex: 0, grossNativeAmountRaw: "10000000000000000" }),
        makeBuyTrade({ blockNumber: "1000", logIndex: 0 }), // at the cursor — already announced
        makeBuyTrade({ blockNumber: "1001", logIndex: 1, direction: "sell" }),
      ),
      readProgress,
      publishTelegramPost: publish,
    });

    expect(result).toMatchObject({ processed: 1, sent: 2, failed: 0, reconnectNeeded: 0, error: null });
    expect(publish).toHaveBeenCalledTimes(2);
    const first = publish.mock.calls[0][0];
    expect(first.botToken).toBe(ENV.TELEGRAM_BOT_TOKEN);
    expect(first.chatId).toBe("@hoodsbuys");
    expect(first.text).toContain("0.01 ETH →");
    expect(first.text).toContain("Graduation 25.0%");
    expect(first.artwork).toMatchObject({ extension: "png" });
    expect(publish.mock.calls[1][0].text).toContain("0.02 ETH →");
    // One progress read per bot per run, not per alert.
    expect(readProgress).toHaveBeenCalledTimes(1);

    const bot = await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN);
    expect(bot).toMatchObject({ cursorBlockNumber: "1002", cursorLogIndex: 0, lastPostedAt: NOW.toISOString(), failureCount: 0 });
  });

  it("applies the bot's own threshold and does not read the channel or progress when nothing qualifies", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store, { thresholdWei: "100000000000000000" });
    const publish = vi.fn(async () => [1]);
    const readProgress = vi.fn(async () => null);
    const getChannel = vi.spyOn(store, "getChannel");
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(makeBuyTrade({ blockNumber: "1001", grossNativeAmountRaw: "50000000000000000" })),
      readProgress,
      publishTelegramPost: publish,
    });
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 0 });
    expect(publish).not.toHaveBeenCalled();
    expect(readProgress).not.toHaveBeenCalled();
    expect(getChannel).not.toHaveBeenCalled();
  });

  it("sends text-only when the launch has no recorded artwork, and names the token by address when no launch record exists", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const publish = vi.fn(async () => [1]);
    await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(null),
      readTrades: trades(makeBuyTrade({ blockNumber: "1001" })),
      readProgress: async () => null,
      publishTelegramPost: publish,
    });
    const call = publish.mock.calls[0][0];
    expect(call.artwork).toBeNull();
    expect(call.text).toContain(`New buy — ${BUY_BOT_TEST_TOKEN}`);
  });

  it("stops at the first Telegram failure, keeps the cursor on the last delivered buy, and counts the failure", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const publish = vi
      .fn<() => Promise<number[]>>()
      .mockResolvedValueOnce([1])
      .mockRejectedValueOnce(new Error("Too Many Requests: retry after 30"));
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(makeBuyTrade({ blockNumber: "1001" }), makeBuyTrade({ blockNumber: "1002" }), makeBuyTrade({ blockNumber: "1003" })),
      readProgress: async () => null,
      publishTelegramPost: publish,
    });
    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 1, reconnectNeeded: 0 });
    expect(publish).toHaveBeenCalledTimes(2);
    const bot = await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN);
    expect(bot).toMatchObject({ status: "active", cursorBlockNumber: "1001", failureCount: 1 });
    expect(bot?.lastError).toContain("Too Many Requests");
  });

  it("flips a bot to reconnect_needed only after BUY_BOT_RECONNECT_FAILURE_THRESHOLD consecutive transient failures", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const publish = vi.fn(async () => {
      throw new Error("Telegram returned HTTP 502.");
    });
    for (let attempt = 1; attempt <= BUY_BOT_RECONNECT_FAILURE_THRESHOLD; attempt += 1) {
      const result = await runBuyBotCron({
        env: ENV,
        now: NOW,
        store,
        launchesStore: launchesStore(),
        readTrades: trades(makeBuyTrade({ blockNumber: "1001" })),
        readProgress: async () => null,
        publishTelegramPost: publish,
      });
      const bot = await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN);
      if (attempt < BUY_BOT_RECONNECT_FAILURE_THRESHOLD) {
        expect(bot?.status).toBe("active");
        expect(result.reconnectNeeded).toBe(0);
      } else {
        expect(bot?.status).toBe("reconnect_needed");
        expect(result.reconnectNeeded).toBe(1);
      }
    }
  });

  it("flips straight to reconnect_needed on a confirmed channel-lost error, and never announces that buy", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const publish = vi.fn(async () => {
      throw new Error("Forbidden: bot was kicked from the channel chat");
    });
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(makeBuyTrade({ blockNumber: "1001" })),
      readProgress: async () => null,
      publishTelegramPost: publish,
    });
    expect(result).toMatchObject({ sent: 0, failed: 1, reconnectNeeded: 1 });
    const bot = await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN);
    expect(bot).toMatchObject({ status: "reconnect_needed", cursorBlockNumber: "1000" });
    expect(bot?.lastError).toContain("add the Buy Bot to your channel again");
  });

  it("marks a bot whose stored channel cannot be decrypted as reconnect_needed instead of posting anywhere", async () => {
    const store = createMemoryBuyBotStore();
    const bot = await seedBot(store);
    store.channels.set(bot.id, "not json");
    const publish = vi.fn(async () => [1]);
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(makeBuyTrade({ blockNumber: "1001" })),
      readProgress: async () => null,
      publishTelegramPost: publish,
    });
    expect(result).toMatchObject({ sent: 0, failed: 1, reconnectNeeded: 1 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("records a trade-read failure without changing the bot's status (the chain being unreachable is not the user's to fix)", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const publish = vi.fn(async () => [1]);
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: async () => {
        throw new Error("RPC unavailable");
      },
      publishTelegramPost: publish,
    });
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1, reconnectNeeded: 0 });
    const bot = await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN);
    expect(bot?.status).toBe("active");
    expect(bot?.lastError).toContain("Trade read failed");
    expect(publish).not.toHaveBeenCalled();
  });

  it("skips (and advances past) a message the fail-closed content filter blocks, rather than retrying it forever", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    const publish = vi.fn(async () => [1]);
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: trades(makeBuyTrade({ blockNumber: "1001" }), makeBuyTrade({ blockNumber: "1002" })),
      readProgress: async () => null,
      publishTelegramPost: publish,
      contentFilterCheck: (fields) => (String(fields.body).includes("0.05 ETH") ? { blocked: true, field: "body" } : { blocked: false }),
    });
    // Both buys are 0.05 ETH in the fixture, so both are blocked: nothing sent, cursor still moves past them.
    expect(result).toMatchObject({ sent: 0, failed: 0 });
    expect(publish).not.toHaveBeenCalled();
    const bot = await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN);
    expect(bot?.cursorBlockNumber).toBe("1002");
  });

  it("isolates one bot's unexpected throw from the rest of the batch", async () => {
    const store = createMemoryBuyBotStore();
    await seedBot(store);
    await store.upsert({
      walletAddress: "0x2222222222222222222222222222222222222222",
      chainId: 46630,
      tokenAddress: "0x00000000000000000000000000000000000000a2",
      curveAddress: "0x00000000000000000000000000000000000000c2",
      channelDisplayName: "Other",
      channelExternalId: "@other",
      channel: JSON.stringify({ chatId: "@other" }),
      thresholdWei: "10000000000000000",
      cursorBlockNumber: "0",
      cursorLogIndex: -1,
    });
    const publish = vi.fn(async () => [1]);
    const result = await runBuyBotCron({
      env: ENV,
      now: NOW,
      store,
      launchesStore: launchesStore(),
      readTrades: async (_chainId, curve) => {
        if (curve === BUY_BOT_TEST_CURVE) throw new TypeError("unexpected shape");
        return [makeBuyTrade({ blockNumber: "5" })];
      },
      readProgress: async () => null,
      publishTelegramPost: publish,
    });
    expect(result).toMatchObject({ processed: 2, sent: 1, failed: 1 });
  });
});

describe("Buy Bot heartbeat plumbing", () => {
  it("uses its own scheduled_job_heartbeats key and maps its counters onto the shared row shape", () => {
    expect(BUY_BOT_JOB_KEY).toBe("buy-bot");
    expect(toHeartbeatResult({ ranAt: NOW.toISOString(), processed: 3, sent: 7, failed: 1, reconnectNeeded: 1, error: null })).toEqual({
      ranAt: NOW.toISOString(),
      processed: 3,
      sent: 7,
      retried: 0,
      failed: 1,
      routedToComposer: 0,
      error: null,
    });
  });

  it("exposes a shared trades-reader seam the enable route and the cron both resolve through", async () => {
    const reader = vi.fn(async () => [makeBuyTrade()]);
    setBuyBotTradesReaderForTests(reader);
    try {
      expect(resolveBuyBotTradesReader()).toBe(reader);
      const store = createMemoryBuyBotStore();
      await seedBot(store, { cursorBlockNumber: "0" });
      await runBuyBotCron({ env: ENV, now: NOW, store, launchesStore: launchesStore(), readProgress: async () => null, publishTelegramPost: async () => [1] });
      expect(reader).toHaveBeenCalledWith(46630, BUY_BOT_TEST_CURVE);
    } finally {
      setBuyBotTradesReaderForTests(null);
    }
  });
});
