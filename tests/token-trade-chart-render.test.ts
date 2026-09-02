import { describe, expect, it } from "vitest";
import { tradeSpotPriceNativePerToken } from "@/lib/candle-bucketing";
import {
  applyChartResize,
  applyTokenTradeChartUpdate,
  computeInitialVisibleLogicalRange,
  createInitialTokenTradeChartRenderState,
  isAtChartRightEdge,
  pointToSeriesDatum,
  volumeBarColor,
  type ChartSeriesLike,
  type ChartTimeScaleLike,
  type TokenTradeChartSeriesBundle,
  type VisibleLogicalRange,
} from "@/lib/token-trade-chart-render";
import type { TokenTrade } from "@/lib/token-trade-types";

// Behavioural coverage for the pure live-update engine behind
// components/token-page/token-trade-chart.tsx (issue #458 item 3),
// extracted specifically so this incremental-update logic could be exercised
// against a fake series object — this repo's Vitest suite runs in a plain
// Node environment with no jsdom, so there is no way to render the real
// "use client" chart component and inspect a real lightweight-charts
// instance. The fake series below mimics the two real behaviours this logic
// actually depends on: `setData` replaces the whole series, and `update`
// replaces the last bar if the time matches, appends if the time is newer,
// or throws "Cannot update oldest data" if the time is older — exactly like
// the real library (see the engine's own doc comment).

type TimeKeyed = { time: number };

function createFakeSeries<T extends TimeKeyed>() {
  let data: T[] = [];
  let setDataCalls = 0;
  let updateCalls = 0;

  const series: ChartSeriesLike<T> = {
    setData: (points) => {
      setDataCalls += 1;
      data = [...points];
    },
    update: (point) => {
      updateCalls += 1;
      const last = data[data.length - 1];
      if (last && point.time < last.time) throw new Error("Cannot update oldest data");
      if (last && point.time === last.time) {
        data = [...data.slice(0, -1), point];
      } else {
        data = [...data, point];
      }
    },
  };

  return {
    series,
    getData: () => data,
    get setDataCalls() {
      return setDataCalls;
    },
    get updateCalls() {
      return updateCalls;
    },
  };
}

/** Starts with no range set (mirrors a freshly created real chart) — every test that needs an initial in-place range sets one explicitly via the first applyTokenTradeChartUpdate call, exactly like production. */
function createFakeTimeScale(): { timeScale: ChartTimeScaleLike; getRange: () => VisibleLogicalRange | null; setRangeCalls: () => number } {
  let visibleRange: VisibleLogicalRange | null = null;
  let setRangeCalls = 0;
  const timeScale: ChartTimeScaleLike = {
    getVisibleLogicalRange: () => visibleRange,
    setVisibleLogicalRange: (range) => {
      setRangeCalls += 1;
      visibleRange = range;
    },
  };
  return { timeScale, getRange: () => visibleRange, setRangeCalls: () => setRangeCalls };
}

type FakeChart = {
  bundle: TokenTradeChartSeriesBundle;
  candle: ReturnType<typeof createFakeSeries<ReturnType<typeof pointToSeriesDatum>>>;
  ma20: ReturnType<typeof createFakeSeries<{ time: number; value: number }>>;
  ma50: ReturnType<typeof createFakeSeries<{ time: number; value: number }>>;
  volume: ReturnType<typeof createFakeSeries<{ time: number; value: number; color: string }>>;
  timeScale: ChartTimeScaleLike;
  getRange: () => VisibleLogicalRange | null;
  setRangeCalls: () => number;
};

function createFakeChart(): FakeChart {
  const candle = createFakeSeries<ReturnType<typeof pointToSeriesDatum>>();
  const ma20 = createFakeSeries<{ time: number; value: number }>();
  const ma50 = createFakeSeries<{ time: number; value: number }>();
  const volume = createFakeSeries<{ time: number; value: number; color: string }>();
  const { timeScale, getRange, setRangeCalls } = createFakeTimeScale();

  const bundle: TokenTradeChartSeriesBundle = {
    candleSeries: candle.series,
    ma20Series: ma20.series,
    ma50Series: ma50.series,
    volumeSeries: volume.series,
    timeScale,
  };

  return { bundle, candle, ma20, ma50, volume, timeScale, getRange, setRangeCalls };
}

const DECIMALS = 18;
const FIVE_MINUTES = 300;

/** The fixed container width used by every test below that doesn't itself vary width — matches a typical desktop chart panel. */
const CHART_WIDTH_PX = 600;

/** A trade priced at exactly `price` ETH per whole token via its post-trade virtual reserves. */
function tradeAtPrice(price: number, overrides: Partial<TokenTrade> = {}): TokenTrade {
  const tokenReserve = 1_000_000;
  const ethReserve = tokenReserve * price;
  return {
    direction: "buy",
    wallet: "0x1111111111111111111111111111111111111111",
    tokenAmountRaw: "1000000000000000000",
    nativeAmountRaw: "10000000000000000",
    blockNumber: "1",
    blockTimestamp: 0,
    txHash: "0xaaaa000000000000000000000000000000000000000000000000000000aa",
    logIndex: 0,
    virtualTokenReserveRaw: String(BigInt(Math.round(tokenReserve * 1e18))),
    virtualEthReserveRaw: String(BigInt(Math.round(ethReserve * 1e18))),
    ...overrides,
  };
}

/** Matches the header band's own derivation: the newest trade's post-trade spot price. */
function headerFigure(trades: TokenTrade[], decimals: number): number {
  const newest = [...trades].sort((a, b) => b.blockTimestamp - a.blockTimestamp || b.logIndex - a.logIndex)[0];
  return tradeSpotPriceNativePerToken(newest, decimals);
}

describe("applyTokenTradeChartUpdate — incremental sell candle (issue #458 item 3)", () => {
  it("replays two buys, then a sell two hours later, then a second later sell — entirely through the incremental update path, producing correct candle content and matching the header figure", () => {
    const chart = createFakeChart();

    const buy1 = tradeAtPrice(0.01, { blockTimestamp: 0, logIndex: 0, txHash: "0x01" });
    const buy2 = tradeAtPrice(0.02, { blockTimestamp: 60, logIndex: 1, txHash: "0x02" });
    const sell1 = tradeAtPrice(0.015, { direction: "sell", blockTimestamp: 7_200, logIndex: 0, txHash: "0x03" });
    const sell2 = tradeAtPrice(0.01, { direction: "sell", blockTimestamp: 10_800, logIndex: 0, txHash: "0x04" });

    // Render 1: the two buys plus the whitespace tail. This is the very
    // first render (hasRenderedOnce: false), so it must go through setData.
    let state = createInitialTokenTradeChartRenderState();
    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [buy2, buy1], // newest-first, matching the real API's ordering
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 600,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    expect(chart.candle.setDataCalls).toBe(1);
    const bucket0AfterRender1 = chart.candle.getData().find((point) => point.time === 0);
    expect(bucket0AfterRender1).toMatchObject({ open: 0.01, close: 0.02 });

    // Render 2: the sell lands two hours later, merged into the trade list
    // exactly as lib/token-trades-merge.ts's mergeTokenTrades would produce.
    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [sell1, buy2, buy1],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 7_200,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    // Still exactly one setData call — the sell was applied via update(), not a resync.
    expect(chart.candle.setDataCalls).toBe(1);
    expect(chart.candle.updateCalls).toBeGreaterThan(0);

    const dataAfterRender2 = chart.candle.getData();
    const sellBucket = dataAfterRender2.find((point) => point.time === 7_200);
    expect(sellBucket).toBeDefined();
    expect(sellBucket).toMatchObject({ open: 0.02, close: 0.015, high: 0.015, low: 0.015 });
    // A price drop within the bucket must render as a red (down) candle.
    expect((sellBucket as { open: number; close: number }).close).toBeLessThan(
      (sellBucket as { open: number; close: number }).open,
    );

    const lastBarAfterRender2 = dataAfterRender2[dataAfterRender2.length - 1];
    expect(lastBarAfterRender2.time).toBe(7_200);
    expect((lastBarAfterRender2 as { close: number }).close).toBeCloseTo(headerFigure([sell1, buy2, buy1], DECIMALS));

    // Render 3: a second, later sell.
    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [sell2, sell1, buy2, buy1],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 10_800,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    expect(chart.candle.setDataCalls).toBe(1);

    const dataAfterRender3 = chart.candle.getData();
    const secondSellBucket = dataAfterRender3.find((point) => point.time === 10_800);
    expect(secondSellBucket).toMatchObject({ open: 0.015, close: 0.01, high: 0.01, low: 0.01 });

    const lastBarAfterRender3 = dataAfterRender3[dataAfterRender3.length - 1];
    expect(lastBarAfterRender3.time).toBe(10_800);
    expect((lastBarAfterRender3 as { close: number }).close).toBeCloseTo(
      headerFigure([sell2, sell1, buy2, buy1], DECIMALS),
    );

    expect(state.hasRenderedOnce).toBe(true);
  });

  it("carries the volume series' bar color from the same real candle the candlestick series just rendered — never an independently computed value", () => {
    const chart = createFakeChart();
    const buy = tradeAtPrice(0.01, { blockTimestamp: 0 });
    const sell = tradeAtPrice(0.005, { direction: "sell", blockTimestamp: FIVE_MINUTES * 3, logIndex: 0, txHash: "0x02" });

    let state = createInitialTokenTradeChartRenderState();
    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [buy],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [sell, buy],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: FIVE_MINUTES * 3,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    const volumeBar = chart.volume.getData().find((point) => point.time === FIVE_MINUTES * 3);
    expect(volumeBar).toBeDefined();
    expect(volumeBar!.color).toBe(volumeBarColor({ time: FIVE_MINUTES * 3, open: 0.01, high: 0.005, low: 0.005, close: 0.005, volume: 0 }));
  });
});

describe("applyTokenTradeChartUpdate — first load / timeframe change vs. incremental update", () => {
  const trades = [tradeAtPrice(0.01, { blockTimestamp: 0 })];

  it("calls setData (never update) on the very first render", () => {
    const chart = createFakeChart();
    applyTokenTradeChartUpdate(chart.bundle, createInitialTokenTradeChartRenderState(), {
      trades,
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    expect(chart.candle.setDataCalls).toBe(1);
    expect(chart.candle.updateCalls).toBe(0);
  });

  it("positions on the timeline's last point (never scrollToRealTime) after the initial setData, via an explicit width-derived visible logical range (issue #467 item 1)", () => {
    const chart = createFakeChart();
    const state = applyTokenTradeChartUpdate(chart.bundle, createInitialTokenTradeChartRenderState(), {
      trades,
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    const lastPointIndex = state.points.length - 1;
    expect(chart.getRange()).toEqual(computeInitialVisibleLogicalRange(lastPointIndex, CHART_WIDTH_PX));
  });

  it("forces a full setData resync (and restores the visible range) on a timeframe change, never an incremental update", () => {
    const chart = createFakeChart();
    let state = createInitialTokenTradeChartRenderState();
    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades,
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    applyTokenTradeChartUpdate(chart.bundle, state, {
      trades,
      decimals: DECIMALS,
      interval: "1h",
      timeframe: "1h",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    expect(chart.candle.setDataCalls).toBe(2);
  });

  it("falls back to a full resync — reading and restoring the visible logical range — when an update() throws (e.g. an out-of-order bucket)", () => {
    const chart = createFakeChart();
    let state = createInitialTokenTradeChartRenderState();
    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades,
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 600,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    // Force the fake candle series into a state where the next update() call
    // would be for a bucket older than its last rendered bar.
    chart.candle.series.update({ time: 100_000 });

    applyTokenTradeChartUpdate(chart.bundle, state, {
      trades,
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 900,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    // The forced resync must have called setData again rather than letting
    // the update() throw break the whole update.
    expect(chart.candle.setDataCalls).toBe(2);
  });
});

describe("computeInitialVisibleLogicalRange (issue #467 item 1)", () => {
  it("derives the visible bar count from chart width / fixed barSpacing, positioning `to` at the last point index plus the fixed right offset", () => {
    const lastPointIndex = 999;
    for (const chartWidthPx of [600, 1400, 2400]) {
      const range = computeInitialVisibleLogicalRange(lastPointIndex, chartWidthPx);
      const expectedTo = lastPointIndex + 4; // fixed rightOffset, matching the chart's own timeScale option
      const expectedVisibleBars = Math.floor(chartWidthPx / 6); // fixed barSpacing
      expect(range.to).toBe(expectedTo);
      expect(range.to - range.from).toBe(expectedVisibleBars);
    }
  });

  it("never widens per candle count — only per width — so bar pixel width stays fixed regardless of how many bars exist", () => {
    const narrow = computeInitialVisibleLogicalRange(10, 600);
    const wide = computeInitialVisibleLogicalRange(10_000, 600);
    expect(wide.to - wide.from).toBe(narrow.to - narrow.from);
  });
});

describe("isAtChartRightEdge / applyChartResize (issue #467 items 1-2)", () => {
  it("treats a null range (chart not yet positioned) as being at the right edge", () => {
    expect(isAtChartRightEdge(null, 500)).toBe(true);
  });

  it("is true when the range's `to` is at or within one bar of the last point index, false once scrolled further left", () => {
    expect(isAtChartRightEdge({ from: 400, to: 500 }, 500)).toBe(true);
    expect(isAtChartRightEdge({ from: 399, to: 499 }, 500)).toBe(true); // within one bar
    expect(isAtChartRightEdge({ from: 300, to: 400 }, 500)).toBe(false);
  });

  it("recomputes the range from the new width on resize while at the right edge", () => {
    const chart = createFakeChart();
    chart.timeScale.setVisibleLogicalRange(computeInitialVisibleLogicalRange(100, CHART_WIDTH_PX));
    applyChartResize(chart.bundle, 100, 1400);
    expect(chart.getRange()).toEqual(computeInitialVisibleLogicalRange(100, 1400));
  });

  it("leaves the range untouched on resize when the viewer has scrolled left", () => {
    const chart = createFakeChart();
    const scrolledRange: VisibleLogicalRange = { from: 0, to: 50 };
    chart.timeScale.setVisibleLogicalRange(scrolledRange);
    applyChartResize(chart.bundle, 500, 1400);
    expect(chart.getRange()).toEqual(scrolledRange);
  });

  it("does nothing when there is no timeline yet (negative last index)", () => {
    const chart = createFakeChart();
    applyChartResize(chart.bundle, -1, 1400);
    expect(chart.setRangeCalls()).toBe(0);
  });
});

describe("applyTokenTradeChartUpdate — follow the clock (issue #467 item 2)", () => {
  it("shifts the visible range by exactly the number of newly appended timeline points when the viewer is at the right edge", () => {
    const chart = createFakeChart();
    let state = applyTokenTradeChartUpdate(chart.bundle, createInitialTokenTradeChartRenderState(), {
      trades: [tradeAtPrice(0.01, { blockTimestamp: 0 })],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    const rangeBefore = chart.getRange()!;
    const pointsBefore = state.points.length;

    // The clock advances by two whitespace bars with no new trade.
    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [tradeAtPrice(0.01, { blockTimestamp: 0 })],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: FIVE_MINUTES * 2,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    const appendedCount = state.points.length - pointsBefore;
    expect(appendedCount).toBeGreaterThan(0);
    expect(chart.getRange()).toEqual({ from: rangeBefore.from + appendedCount, to: rangeBefore.to + appendedCount });
  });

  it("leaves the visible range alone when the viewer has scrolled left, even though new points were appended", () => {
    const chart = createFakeChart();
    let state = applyTokenTradeChartUpdate(chart.bundle, createInitialTokenTradeChartRenderState(), {
      trades: [tradeAtPrice(0.01, { blockTimestamp: 0 })],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    // Simulate the viewer scrolling back to the very start of the timeline.
    const scrolledRange: VisibleLogicalRange = { from: 0, to: 50 };
    chart.timeScale.setVisibleLogicalRange(scrolledRange);
    const setRangeCallsBeforeUpdate = chart.setRangeCalls();

    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [tradeAtPrice(0.01, { blockTimestamp: 0 })],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: FIVE_MINUTES * 2,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    expect(state.points.length).toBeGreaterThan(0);
    expect(chart.getRange()).toEqual(scrolledRange);
    expect(chart.setRangeCalls()).toBe(setRangeCallsBeforeUpdate);
  });

  it("re-applies the follow rule after the out-of-order full-resync fallback: the range is restored, then shifted by the appended count", () => {
    const chart = createFakeChart();
    let state = applyTokenTradeChartUpdate(chart.bundle, createInitialTokenTradeChartRenderState(), {
      trades: [tradeAtPrice(0.01, { blockTimestamp: 0 })],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 600,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });
    const rangeBefore = chart.getRange()!;
    const pointsBefore = state.points.length;

    // Force the next update() call to throw, triggering the full-resync fallback.
    chart.candle.series.update({ time: 100_000 });

    state = applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [tradeAtPrice(0.01, { blockTimestamp: 0 })],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: 900,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
      chartWidthPx: CHART_WIDTH_PX,
    });

    const appendedCount = state.points.length - pointsBefore;
    expect(appendedCount).toBeGreaterThan(0);
    expect(chart.getRange()).toEqual({ from: rangeBefore.from + appendedCount, to: rangeBefore.to + appendedCount });
  });
});

describe("no code path calls scrollToRealTime or fitContent (issue #467 item 6)", () => {
  it("the engine no longer calls, or exposes an interface member for, scrollToRealTime/fitContent — positioning is owned entirely by the visible-logical-range functions above", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.join(process.cwd(), "lib/token-trade-chart-render.ts"), "utf8");
    expect(source).not.toContain("scrollToRealTime(");
    expect(source).not.toContain("fitContent(");
  });

  it("the real chart component no longer calls scrollToRealTime or fitContent on the time scale", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(path.join(process.cwd(), "components/token-page/token-trade-chart.tsx"), "utf8");
    expect(source).not.toContain("scrollToRealTime(");
    expect(source).not.toContain("fitContent(");
  });
});
