import { describe, expect, it } from "vitest";
import {
  buildSparkline,
  SPARKLINE_DOWN_COLOR,
  SPARKLINE_FLAT_COLOR,
  SPARKLINE_HEIGHT,
  SPARKLINE_UP_COLOR,
  SPARKLINE_WIDTH,
  sparklineColor,
} from "@/lib/token-sparkline";
import type { TokenTrade } from "@/lib/token-trade-types";

// Reuses tokenAmountRaw/nativeAmountRaw as the post-trade virtual reserves
// too (issue #458): buildSparkline now prices off tradeSpotPriceNativePerToken
// (virtualEthReserveRaw ÷ virtualTokenReserveRaw), and every fixture below
// was written assuming its price is nativeAmountRaw ÷ tokenAmountRaw — this
// keeps every existing price assumption valid without rewriting each case.
function trade(overrides: Partial<TokenTrade> = {}): TokenTrade {
  const tokenAmountRaw = overrides.tokenAmountRaw ?? "1000000000000000000";
  const nativeAmountRaw = overrides.nativeAmountRaw ?? "10000000000000000";
  return {
    direction: "buy",
    wallet: "0x1111111111111111111111111111111111111111",
    tokenAmountRaw,
    nativeAmountRaw,
    blockNumber: "1",
    blockTimestamp: 0,
    txHash: "0xaaaa000000000000000000000000000000000000000000000000000000aa",
    logIndex: 0,
    virtualTokenReserveRaw: tokenAmountRaw,
    virtualEthReserveRaw: nativeAmountRaw,
    ...overrides,
  };
}

describe("buildSparkline", () => {
  it("returns a flat baseline for zero trades, never an error or empty box", () => {
    const result = buildSparkline([]);
    expect(result.hasData).toBe(false);
    expect(result.trend).toBe("flat");
    expect(result.changePercent).toBeNull();
    expect(result.linePath).toBe(`M0,${SPARKLINE_HEIGHT / 2} L${SPARKLINE_WIDTH},${SPARKLINE_HEIGHT / 2}`);
    expect(result.areaPath).toContain(result.linePath);
  });

  it("returns a flat baseline for a single trade — one point has no direction to plot", () => {
    const result = buildSparkline([trade({ blockTimestamp: 100 })]);
    expect(result.hasData).toBe(false);
    expect(result.trend).toBe("flat");
    expect(result.changePercent).toBeNull();
    expect(result.firstTimestamp).toBe(100);
    expect(result.lastTimestamp).toBe(100);
  });

  it("plots an upward trend when the last price is higher than the first", () => {
    const result = buildSparkline([
      trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 60, nativeAmountRaw: "20000000000000000", logIndex: 1 }),
    ]);
    expect(result.hasData).toBe(true);
    expect(result.trend).toBe("up");
    expect(result.changePercent).toBeCloseTo(100);
  });

  it("plots a downward trend when the last price is lower than the first", () => {
    const result = buildSparkline([
      trade({ blockTimestamp: 0, nativeAmountRaw: "20000000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 60, nativeAmountRaw: "10000000000000000", logIndex: 1 }),
    ]);
    expect(result.hasData).toBe(true);
    expect(result.trend).toBe("down");
    expect(result.changePercent).toBeCloseTo(-50);
  });

  it("treats an unchanged price across trades as flat", () => {
    const result = buildSparkline([
      trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 60, nativeAmountRaw: "10000000000000000", logIndex: 1 }),
    ]);
    expect(result.hasData).toBe(true);
    expect(result.trend).toBe("flat");
    expect(result.changePercent).toBeCloseTo(0);
  });

  it("orders trades chronologically before plotting regardless of input order", () => {
    const outOfOrder = buildSparkline([
      trade({ blockTimestamp: 60, nativeAmountRaw: "20000000000000000", logIndex: 1 }),
      trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
    ]);
    const inOrder = buildSparkline([
      trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
      trade({ blockTimestamp: 60, nativeAmountRaw: "20000000000000000", logIndex: 1 }),
    ]);
    expect(outOfOrder.linePath).toBe(inOrder.linePath);
    expect(outOfOrder.trend).toBe("up");
  });

  it("drops a zero-priced trade instead of corrupting the plotted range", () => {
    const result = buildSparkline([
      trade({ blockTimestamp: 0, tokenAmountRaw: "0", logIndex: 0 }),
      trade({ blockTimestamp: 60, nativeAmountRaw: "10000000000000000", logIndex: 1 }),
      trade({ blockTimestamp: 120, nativeAmountRaw: "20000000000000000", logIndex: 2 }),
    ]);
    expect(result.hasData).toBe(true);
    expect(result.firstTimestamp).toBe(60);
  });

  it("spans the full requested width with points at both edges", () => {
    const result = buildSparkline(
      [
        trade({ blockTimestamp: 0, nativeAmountRaw: "10000000000000000", logIndex: 0 }),
        trade({ blockTimestamp: 60, nativeAmountRaw: "15000000000000000", logIndex: 1 }),
        trade({ blockTimestamp: 120, nativeAmountRaw: "20000000000000000", logIndex: 2 }),
      ],
      { width: 50, height: 20 },
    );
    expect(result.linePath.startsWith("M0.00,")).toBe(true);
    expect(result.linePath).toContain("L50.00,");
  });
});

describe("sparklineColor", () => {
  it("maps each trend to the site's up/down colours, and flat to a neutral colour", () => {
    expect(sparklineColor("up")).toBe(SPARKLINE_UP_COLOR);
    expect(sparklineColor("down")).toBe(SPARKLINE_DOWN_COLOR);
    expect(sparklineColor("flat")).toBe(SPARKLINE_FLAT_COLOR);
  });
});
