import { randomUUID } from "node:crypto";
import type { BuyBot, BuyBotStore, UpsertBuyBotInput } from "@/lib/server/buy-bot-store";
import type { TokenTrade } from "@/lib/token-trade-types";

// In-memory BuyBotStore for tests, mirroring tests/social-connections-test-helpers.ts:
// exercises the interface contract without a real Postgres instance and is
// shared by the store, cron and route suites.

export function createMemoryBuyBotStore(): BuyBotStore & { channels: Map<string, string> } {
  const bots = new Map<string, BuyBot>();
  const channels = new Map<string, string>();

  function key(walletAddress: string, chainId: number, tokenAddress: string): string {
    return `${walletAddress.toLowerCase()}:${chainId}:${tokenAddress.toLowerCase()}`;
  }
  function byId(id: string): [string, BuyBot] | null {
    for (const entry of bots) if (entry[1].id === id) return entry;
    return null;
  }

  return {
    channels,

    async get(walletAddress, chainId, tokenAddress) {
      return bots.get(key(walletAddress, chainId, tokenAddress)) ?? null;
    },

    async listForWallet(walletAddress) {
      return [...bots.values()].filter((bot) => bot.walletAddress.toLowerCase() === walletAddress.toLowerCase());
    },

    async listActive(limit) {
      return [...bots.values()]
        .filter((bot) => bot.status === "active")
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        .slice(0, limit);
    },

    async upsert(input: UpsertBuyBotInput) {
      const mapKey = key(input.walletAddress, input.chainId, input.tokenAddress);
      const now = new Date().toISOString();
      const existing = bots.get(mapKey);
      const bot: BuyBot = {
        id: existing?.id ?? randomUUID(),
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        tokenAddress: input.tokenAddress,
        curveAddress: input.curveAddress,
        channelDisplayName: input.channelDisplayName,
        channelExternalId: input.channelExternalId,
        thresholdWei: input.thresholdWei,
        status: "active",
        cursorBlockNumber: input.cursorBlockNumber,
        cursorLogIndex: input.cursorLogIndex,
        failureCount: 0,
        lastError: null,
        lastPostedAt: existing?.lastPostedAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      bots.set(mapKey, bot);
      channels.set(bot.id, input.channel);
      return bot;
    },

    async updateSettings(walletAddress, chainId, tokenAddress, changes) {
      const mapKey = key(walletAddress, chainId, tokenAddress);
      const existing = bots.get(mapKey);
      if (!existing) return null;
      const resumed = changes.status === "active";
      const next: BuyBot = {
        ...existing,
        thresholdWei: changes.thresholdWei ?? existing.thresholdWei,
        status: changes.status ?? existing.status,
        failureCount: resumed ? 0 : existing.failureCount,
        lastError: resumed ? null : existing.lastError,
        updatedAt: new Date().toISOString(),
      };
      bots.set(mapKey, next);
      return next;
    },

    async delete(walletAddress, chainId, tokenAddress) {
      const mapKey = key(walletAddress, chainId, tokenAddress);
      const existing = bots.get(mapKey);
      if (existing) channels.delete(existing.id);
      bots.delete(mapKey);
    },

    async getChannel(id) {
      const plaintext = channels.get(id);
      return plaintext !== undefined ? { status: "ok", plaintext } : { status: "not_found" };
    },

    async advanceCursor(id, cursorBlockNumber, cursorLogIndex, postedAt) {
      const entry = byId(id);
      if (!entry) return;
      bots.set(entry[0], {
        ...entry[1],
        cursorBlockNumber,
        cursorLogIndex,
        lastPostedAt: postedAt.toISOString(),
        failureCount: 0,
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
    },

    async recordFailure(id, reason, threshold) {
      const entry = byId(id);
      if (!entry) return;
      const failureCount = entry[1].failureCount + 1;
      bots.set(entry[0], {
        ...entry[1],
        failureCount,
        lastError: reason,
        status: failureCount >= threshold ? "reconnect_needed" : entry[1].status,
        updatedAt: new Date().toISOString(),
      });
    },

    async markReconnectNeeded(id, reason) {
      const entry = byId(id);
      if (!entry) return;
      bots.set(entry[0], { ...entry[1], status: "reconnect_needed", lastError: reason, updatedAt: new Date().toISOString() });
    },

    async countByStatus() {
      const counts = { active: 0, paused: 0, reconnect_needed: 0 };
      for (const bot of bots.values()) counts[bot.status] += 1;
      return counts;
    },

    async countPostedLast24h() {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return [...bots.values()].filter((bot) => bot.lastPostedAt && new Date(bot.lastPostedAt).getTime() >= cutoff).length;
    },

    async tableExists() {
      return true;
    },
  };
}

export const BUY_BOT_TEST_CURVE = "0x00000000000000000000000000000000000000c1" as `0x${string}`;
export const BUY_BOT_TEST_TOKEN = "0x00000000000000000000000000000000000000a1";

/** A curve buy fixture with every field the alert formatter reads; override anything per test. */
export function makeBuyTrade(overrides: Partial<TokenTrade> = {}): TokenTrade {
  return {
    direction: "buy",
    wallet: "0x1234567890abcdef1234567890abcdef12345678",
    tokenAmountRaw: (1_234_567n * 10n ** 18n).toString(),
    nativeAmountRaw: "49500000000000000",
    grossNativeAmountRaw: "50000000000000000",
    feeChargedRaw: "500000000000000",
    virtualTokenReserveRaw: (1_000_000_000n * 10n ** 18n).toString(),
    virtualEthReserveRaw: "3500000000000000",
    blockNumber: "1000",
    blockTimestamp: 1_760_000_000,
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 0,
    venue: "curve",
    ...overrides,
  };
}
