import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuyBotStoreUnavailableError, getBuyBotStore, resetBuyBotStoreForTests, toBuyBotSummary } from "@/lib/server/buy-bot-store";
import { BUY_BOT_TEST_CURVE, BUY_BOT_TEST_TOKEN, createMemoryBuyBotStore } from "./buy-bot-test-helpers";

const WALLET = "0xAbC0000000000000000000000000000000000001";

afterEach(() => {
  resetBuyBotStoreForTests();
  delete process.env.DATABASE_URL;
});

describe("unconfigured Buy Bot store (no DATABASE_URL)", () => {
  it("fails safe on read paths without throwing, and throws only on write paths", async () => {
    delete process.env.DATABASE_URL;
    const store = getBuyBotStore();

    await expect(store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN)).resolves.toBeNull();
    await expect(store.listForWallet(WALLET)).resolves.toEqual([]);
    await expect(store.listActive(10)).resolves.toEqual([]);
    await expect(store.getChannel("id")).resolves.toEqual({ status: "not_found" });
    await expect(store.countByStatus()).resolves.toEqual({ active: 0, paused: 0, reconnect_needed: 0 });
    await expect(store.countPostedLast24h()).resolves.toBe(0);
    await expect(store.tableExists()).resolves.toBe(false);

    const input = {
      walletAddress: WALLET,
      chainId: 46630,
      tokenAddress: BUY_BOT_TEST_TOKEN,
      curveAddress: BUY_BOT_TEST_CURVE,
      channelDisplayName: "d",
      channelExternalId: "@c",
      channel: "{}",
      thresholdWei: "10000000000000000",
      cursorBlockNumber: "0",
      cursorLogIndex: -1,
    };
    await expect(store.upsert(input)).rejects.toBeInstanceOf(BuyBotStoreUnavailableError);
    await expect(store.updateSettings(WALLET, 46630, BUY_BOT_TEST_TOKEN, { status: "paused" })).rejects.toBeInstanceOf(BuyBotStoreUnavailableError);
    await expect(store.delete(WALLET, 46630, BUY_BOT_TEST_TOKEN)).rejects.toBeInstanceOf(BuyBotStoreUnavailableError);
    await expect(store.advanceCursor("id", "1", 0, new Date())).rejects.toBeInstanceOf(BuyBotStoreUnavailableError);
    await expect(store.recordFailure("id", "r", 3)).rejects.toBeInstanceOf(BuyBotStoreUnavailableError);
    await expect(store.markReconnectNeeded("id", "r")).rejects.toBeInstanceOf(BuyBotStoreUnavailableError);
  });
});

describe("Buy Bot lifecycle (memory contract)", () => {
  const input = {
    walletAddress: WALLET,
    chainId: 46630,
    tokenAddress: BUY_BOT_TEST_TOKEN,
    curveAddress: BUY_BOT_TEST_CURVE,
    channelDisplayName: "HOODS Buys",
    channelExternalId: "@hoodsbuys",
    channel: JSON.stringify({ chatId: "@hoodsbuys" }),
    thresholdWei: "10000000000000000",
    cursorBlockNumber: "1000",
    cursorLogIndex: 3,
  };

  it("upserts as active with zero failures, reads back case-insensitively, and re-binding resets status/cursor/failures", async () => {
    const store = createMemoryBuyBotStore();
    const bot = await store.upsert(input);
    expect(bot).toMatchObject({ status: "active", failureCount: 0, cursorBlockNumber: "1000", cursorLogIndex: 3 });
    expect(await store.get(WALLET.toLowerCase(), 46630, BUY_BOT_TEST_TOKEN.toUpperCase().replace("0X", "0x"))).toMatchObject({ id: bot.id });

    await store.markReconnectNeeded(bot.id, "kicked");
    const rebound = await store.upsert({ ...input, channelExternalId: "@newchannel", channel: JSON.stringify({ chatId: "@newchannel" }), cursorBlockNumber: "2000", cursorLogIndex: 0 });
    expect(rebound).toMatchObject({ id: bot.id, status: "active", failureCount: 0, lastError: null, channelExternalId: "@newchannel", cursorBlockNumber: "2000" });
    expect(await store.getChannel(bot.id)).toEqual({ status: "ok", plaintext: JSON.stringify({ chatId: "@newchannel" }) });
  });

  it("only lists active bots for the cron; paused and reconnect_needed are excluded", async () => {
    const store = createMemoryBuyBotStore();
    const a = await store.upsert(input);
    await store.upsert({ ...input, tokenAddress: "0x00000000000000000000000000000000000000a2" });
    await store.upsert({ ...input, tokenAddress: "0x00000000000000000000000000000000000000a3" });
    await store.updateSettings(WALLET, 46630, "0x00000000000000000000000000000000000000a2", { status: "paused" });
    await store.markReconnectNeeded((await store.get(WALLET, 46630, "0x00000000000000000000000000000000000000a3"))!.id, "gone");
    expect((await store.listActive(10)).map((bot) => bot.id)).toEqual([a.id]);
    expect(await store.countByStatus()).toEqual({ active: 1, paused: 1, reconnect_needed: 1 });
  });

  it("resuming clears the failure counter and last error; a threshold-only change leaves them alone", async () => {
    const store = createMemoryBuyBotStore();
    const bot = await store.upsert(input);
    await store.recordFailure(bot.id, "boom", 10);
    const thresholdOnly = await store.updateSettings(WALLET, 46630, BUY_BOT_TEST_TOKEN, { thresholdWei: "50000000000000000" });
    expect(thresholdOnly).toMatchObject({ thresholdWei: "50000000000000000", failureCount: 1, lastError: "boom" });
    const resumed = await store.updateSettings(WALLET, 46630, BUY_BOT_TEST_TOKEN, { status: "active" });
    expect(resumed).toMatchObject({ failureCount: 0, lastError: null });
    expect(await store.updateSettings("0x0000000000000000000000000000000000000009", 46630, BUY_BOT_TEST_TOKEN, { status: "paused" })).toBeNull();
  });

  it("advancing the cursor stamps last_posted_at and clears failures; recordFailure flips at the threshold", async () => {
    const store = createMemoryBuyBotStore();
    const bot = await store.upsert(input);
    await store.recordFailure(bot.id, "transient", 3);
    await store.advanceCursor(bot.id, "1001", 0, new Date("2020-01-01T12:00:00Z"));
    expect(await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN)).toMatchObject({ cursorBlockNumber: "1001", failureCount: 0, lastPostedAt: "2020-01-01T12:00:00.000Z" });
    expect(await store.countPostedLast24h()).toBe(0);
    await store.advanceCursor(bot.id, "1002", 0, new Date());
    expect(await store.countPostedLast24h()).toBe(1);
    await store.recordFailure(bot.id, "x", 2);
    await store.recordFailure(bot.id, "y", 2);
    expect((await store.get(WALLET, 46630, BUY_BOT_TEST_TOKEN))?.status).toBe("reconnect_needed");
  });

  it("projects a bot for the client without the binding, cursor or internal id", async () => {
    const store = createMemoryBuyBotStore();
    const bot = await store.upsert(input);
    const summary = toBuyBotSummary(bot);
    expect(Object.keys(summary).sort()).toEqual(
      ["chainId", "channelDisplayName", "channelExternalId", "createdAt", "lastError", "lastPostedAt", "status", "thresholdWei", "tokenAddress", "updatedAt"].sort(),
    );
  });
});

describe("Postgres Buy Bot store SQL (source-level guards)", () => {
  it("encrypts the channel before it reaches the row, casts every reused parameter, and never selects the ciphertext into the client-facing columns", async () => {
    const source = await readFile(path.join(process.cwd(), "lib/server/buy-bot-store.ts"), "utf8");
    expect(source).toContain("const encrypted = encryptSocialCredentials(input.channel);");
    expect(source).toContain("decryptSocialCredentials(row.encrypted_channel)");
    // BOT_COLUMNS must never include the ciphertext — only getChannel reads it.
    const columns = source.slice(source.indexOf("const BOT_COLUMNS"), source.indexOf("export function createPostgresBuyBotStore"));
    expect(columns).not.toContain("encrypted_channel");
    // Issue #386 lesson: a positional parameter reused in several expressions carries an explicit cast at every occurrence.
    const postgres = source.slice(source.indexOf("export function createPostgresBuyBotStore"));
    const update = postgres.slice(postgres.indexOf("async updateSettings"), postgres.indexOf("async delete"));
    expect(update.match(/\$5::text/g)?.length).toBe(3);
    expect(update).not.toMatch(/\$5[^:]/);
    expect(source).toContain("ON CONFLICT (LOWER(wallet_address), chain_id, LOWER(token_address)) DO UPDATE SET");
  });
});
