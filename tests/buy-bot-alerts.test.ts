import { describe, expect, it } from "vitest";
import {
  BUY_BOT_THRESHOLD_PRESETS,
  DEFAULT_BUY_BOT_THRESHOLD_WEI,
  buyBotThresholdWeiForLabel,
  formatBuyBotThreshold,
  isBuyBotThresholdPreset,
} from "@/lib/buy-bot-presets";
import {
  MAX_BUY_ALERTS_PER_RUN,
  buyGrossNativeWei,
  compareTradeOrder,
  formatBuyAlertMessage,
  isTelegramChannelLostError,
  newestTradeCursor,
  selectBuyAlerts,
} from "@/lib/server/buy-bot-alerts";
import { makeBuyTrade } from "./buy-bot-test-helpers";

describe("Buy Bot threshold presets (owner decisions, 5 Sep 2026)", () => {
  it("offers exactly the three thresholds the Rules row has always drawn, defaulting to 0.01 ETH", () => {
    expect(BUY_BOT_THRESHOLD_PRESETS.map((preset) => preset.label)).toEqual(["0.01 ETH", "0.05 ETH", "0.1 ETH"]);
    expect(BUY_BOT_THRESHOLD_PRESETS.map((preset) => preset.wei)).toEqual(["10000000000000000", "50000000000000000", "100000000000000000"]);
    expect(DEFAULT_BUY_BOT_THRESHOLD_WEI).toBe("10000000000000000");
  });

  it("accepts only a preset wei string — never an arbitrary or numeric threshold", () => {
    expect(isBuyBotThresholdPreset("50000000000000000")).toBe(true);
    expect(isBuyBotThresholdPreset("50000000000000001")).toBe(false);
    expect(isBuyBotThresholdPreset(50000000000000000)).toBe(false);
    expect(isBuyBotThresholdPreset("0.05 ETH")).toBe(false);
    expect(isBuyBotThresholdPreset(undefined)).toBe(false);
  });

  it("round-trips label <-> wei and never throws for an unknown stored value", () => {
    expect(formatBuyBotThreshold("100000000000000000")).toBe("0.1 ETH");
    expect(buyBotThresholdWeiForLabel("0.1 ETH")).toBe("100000000000000000");
    expect(buyBotThresholdWeiForLabel("nope")).toBe(DEFAULT_BUY_BOT_THRESHOLD_WEI);
    expect(formatBuyBotThreshold("123")).toBe("123 wei");
  });
});

describe("selectBuyAlerts", () => {
  const cursor = { blockNumber: "1000", logIndex: 0 };

  it("orders by block then log index, using bigint block comparison", () => {
    expect(compareTradeOrder({ blockNumber: "99999999999999999999", logIndex: 0 }, { blockNumber: "1000", logIndex: 5 })).toBeGreaterThan(0);
    expect(compareTradeOrder({ blockNumber: "1000", logIndex: 2 }, { blockNumber: "1000", logIndex: 5 })).toBeLessThan(0);
    expect(compareTradeOrder({ blockNumber: "1000", logIndex: 5 }, { blockNumber: "1000", logIndex: 5 })).toBe(0);
  });

  it("seats a new bot's cursor at the newest existing trade, or the zero cursor for a curve with no trades", () => {
    expect(newestTradeCursor([])).toEqual({ blockNumber: "0", logIndex: -1 });
    const trades = [
      makeBuyTrade({ blockNumber: "1000", logIndex: 3 }),
      makeBuyTrade({ blockNumber: "1002", logIndex: 0, direction: "sell" }),
      makeBuyTrade({ blockNumber: "1001", logIndex: 7 }),
    ];
    // Newest by position regardless of direction — a sell can be the newest trade too.
    expect(newestTradeCursor(trades)).toEqual({ blockNumber: "1002", logIndex: 0 });
  });

  it("returns only buys strictly after the cursor, at or above the threshold, oldest first", () => {
    const trades = [
      makeBuyTrade({ blockNumber: "1003", logIndex: 0, grossNativeAmountRaw: "10000000000000000" }), // exactly 0.01 — included
      makeBuyTrade({ blockNumber: "1000", logIndex: 0 }), // at the cursor — excluded
      makeBuyTrade({ blockNumber: "999", logIndex: 9 }), // before the cursor — excluded
      makeBuyTrade({ blockNumber: "1001", logIndex: 0, direction: "sell" }), // a sell — never announced
      makeBuyTrade({ blockNumber: "1002", logIndex: 1, grossNativeAmountRaw: "9999999999999999" }), // below 0.01 — excluded
      makeBuyTrade({ blockNumber: "1000", logIndex: 1, grossNativeAmountRaw: "50000000000000000" }), // same block, later log — included
    ];
    const selected = selectBuyAlerts(trades, cursor, DEFAULT_BUY_BOT_THRESHOLD_WEI);
    expect(selected.map((trade) => [trade.blockNumber, trade.logIndex])).toEqual([
      ["1000", 1],
      ["1003", 0],
    ]);
  });

  it("measures the threshold against the gross amount the buyer paid, falling back to the post-fee amount only when gross is absent", () => {
    expect(buyGrossNativeWei(makeBuyTrade({ grossNativeAmountRaw: "7", nativeAmountRaw: "5" }))).toBe(7n);
    expect(buyGrossNativeWei(makeBuyTrade({ grossNativeAmountRaw: undefined, nativeAmountRaw: "5" }))).toBe(5n);
  });

  it("caps a burst at MAX_BUY_ALERTS_PER_RUN, keeping the oldest so the cursor advances in order", () => {
    const trades = Array.from({ length: 12 }, (_, index) => makeBuyTrade({ blockNumber: String(2000 + index), logIndex: 0 }));
    const selected = selectBuyAlerts(trades, cursor, DEFAULT_BUY_BOT_THRESHOLD_WEI);
    expect(MAX_BUY_ALERTS_PER_RUN).toBe(5);
    expect(selected).toHaveLength(5);
    expect(selected[0].blockNumber).toBe("2000");
    expect(selected[4].blockNumber).toBe("2004");
  });

  it("announces post-graduation pool buys too — 'every purchase' does not stop at graduation", () => {
    const trades = [makeBuyTrade({ blockNumber: "3000", logIndex: 0, venue: "pool", spotPriceNativePerTokenRaw: "3500000" })];
    expect(selectBuyAlerts(trades, cursor, DEFAULT_BUY_BOT_THRESHOLD_WEI)).toHaveLength(1);
  });
});

describe("formatBuyAlertMessage", () => {
  const base = {
    tokenName: "Hoodlums Test",
    ticker: "hoods",
    decimals: 18,
    chain: "robinhood" as const,
    tokenAddress: "0x00000000000000000000000000000000000000a1",
    trade: makeBuyTrade(),
  };

  it("reads every figure off the trade's own fields through the token page's formatters, with the ticker upper-cased", () => {
    const text = formatBuyAlertMessage({ ...base, progress: { state: "bonding", progressBps: 4250n, raisedWei: 1n, targetWei: 2n, liquidityPool: null } });
    const lines = text.split("\n");
    expect(lines[0]).toBe("🟢 New buy — Hoodlums Test ($HOODS)");
    expect(lines[1]).toBe("0.05 ETH → 1,234,567 HOODS");
    expect(lines[2]).toBe("Buyer 0x1234…5678");
    // Spot price = virtualEth / virtualToken = 0.0035 / 1e9 = 3.5e-12, six significant figures.
    expect(lines[3]).toContain("Price 0.00000000000350000 ETH");
    expect(lines[3]).toContain("Graduation 42.5%");
    expect(lines[4]).toBe("Trade on Hoodlums: https://hoodlums.dev/token/robinhood/0x00000000000000000000000000000000000000a1");
  });

  it("says graduated instead of a percentage once the curve has graduated, and omits the stats line with no progress read", () => {
    const graduated = formatBuyAlertMessage({
      ...base,
      progress: { state: "graduated", progressBps: 10_000n, raisedWei: 2n, targetWei: 2n, liquidityPool: "0x00000000000000000000000000000000000000b1" },
    });
    expect(graduated).toContain("Graduated · trading on the locked pool");
    expect(graduated).not.toContain("Graduation ");

    const noProgress = formatBuyAlertMessage({ ...base, progress: null, trade: makeBuyTrade({ virtualEthReserveRaw: undefined, virtualTokenReserveRaw: undefined }) });
    expect(noProgress.split("\n")).toHaveLength(4);
    expect(noProgress).not.toContain("Price ");
  });

  it("is plain text short enough to ride as the artwork's photo caption (≤ 1024 chars) and never uses Telegram markup", () => {
    const text = formatBuyAlertMessage({ ...base, tokenName: "A".repeat(200), progress: null });
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(text).not.toMatch(/<[a-z]+>|\*\*|__/);
  });
});

describe("isTelegramChannelLostError", () => {
  it("recognises the Telegram errors that mean the bot can no longer post in that channel", () => {
    for (const message of [
      "Bad Request: chat not found",
      "Forbidden: bot was kicked from the channel chat",
      "Bad Request: need administrator rights in the channel chat",
      "Bad Request: not enough rights to send text messages to the chat",
      "Bad Request: CHAT_WRITE_FORBIDDEN",
    ]) {
      expect(isTelegramChannelLostError(message), message).toBe(true);
    }
  });

  it("treats anything else (rate limits, timeouts, 5xx) as transient", () => {
    expect(isTelegramChannelLostError("Too Many Requests: retry after 30")).toBe(false);
    expect(isTelegramChannelLostError("Telegram returned HTTP 502.")).toBe(false);
    expect(isTelegramChannelLostError("The operation was aborted due to timeout")).toBe(false);
  });
});
