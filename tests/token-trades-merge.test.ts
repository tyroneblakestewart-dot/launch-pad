import { describe, expect, it } from "vitest";
import { mergeTokenTrades, tokenTradeKey } from "@/lib/token-trades-merge";
import type { TokenTrade } from "@/lib/token-trade-types";

function trade(overrides: Partial<TokenTrade> = {}): TokenTrade {
  return {
    direction: "buy",
    wallet: "0x1111111111111111111111111111111111111111",
    tokenAmountRaw: "1000000000000000000",
    nativeAmountRaw: "10000000000000000",
    blockNumber: "1",
    blockTimestamp: 0,
    txHash: "0xaaaa000000000000000000000000000000000000000000000000000000aa",
    logIndex: 0,
    ...overrides,
  };
}

describe("tokenTradeKey", () => {
  it("keys a trade by tx hash + log index", () => {
    expect(tokenTradeKey(trade({ txHash: "0xabc", logIndex: 3 }))).toBe("0xabc:3");
  });

  it("distinguishes two logs within the same transaction", () => {
    const a = tokenTradeKey(trade({ txHash: "0xabc", logIndex: 0 }));
    const b = tokenTradeKey(trade({ txHash: "0xabc", logIndex: 1 }));
    expect(a).not.toBe(b);
  });
});

describe("mergeTokenTrades", () => {
  it("returns the incoming list as-is on first load (no previous trades)", () => {
    const incoming = [trade({ txHash: "0xa", logIndex: 0 })];
    expect(mergeTokenTrades([], incoming)).toBe(incoming);
  });

  it("returns the previous (not the incoming) empty array reference when both are empty, so a zero-trade token's poll never re-triggers the chart's empty-state setup (issue #447 item 5)", () => {
    const previous: TokenTrade[] = [];
    const incoming: TokenTrade[] = [];
    expect(mergeTokenTrades(previous, incoming)).toBe(previous);
  });

  it("returns the exact same array reference when the incoming poll has nothing new", () => {
    const previous = [
      trade({ txHash: "0xa", logIndex: 0, blockTimestamp: 100 }),
      trade({ txHash: "0xb", logIndex: 0, blockTimestamp: 50 }),
    ];
    // A fresh array of trade objects with identical keys — simulating a
    // brand-new fetch response that happens to describe the same trades.
    const incoming = [
      trade({ txHash: "0xb", logIndex: 0, blockTimestamp: 50 }),
      trade({ txHash: "0xa", logIndex: 0, blockTimestamp: 100 }),
    ];
    expect(mergeTokenTrades(previous, incoming)).toBe(previous);
  });

  it("appends a genuinely new trade and keeps the previously-held trade objects untouched", () => {
    const existing = trade({ txHash: "0xa", logIndex: 0, blockTimestamp: 100 });
    const previous = [existing];
    const newTrade = trade({ txHash: "0xc", logIndex: 0, blockTimestamp: 200 });
    const incoming = [newTrade, existing];

    const merged = mergeTokenTrades(previous, incoming);
    expect(merged).not.toBe(previous);
    expect(merged).toHaveLength(2);
    expect(merged).toContain(existing);
    expect(merged).toContain(newTrade);
  });

  it("re-sorts the merged result newest-first, matching the server's own ordering", () => {
    const older = trade({ txHash: "0xa", logIndex: 0, blockTimestamp: 100 });
    const previous = [older];
    const newer = trade({ txHash: "0xb", logIndex: 0, blockTimestamp: 200 });
    const merged = mergeTokenTrades(previous, [newer, older]);
    expect(merged[0]).toBe(newer);
    expect(merged[1]).toBe(older);
  });
});
