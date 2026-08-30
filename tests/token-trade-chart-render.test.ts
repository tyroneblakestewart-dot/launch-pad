import { describe, expect, it } from "vitest";
import { tradeSpotPriceNativePerToken } from "@/lib/candle-bucketing";
import {
  applyTokenTradeChartUpdate,
  createInitialTokenTradeChartRenderState,
  pointToSeriesDatum,
  volumeBarColor,
  type ChartSeriesLike,
  type ChartTimeScaleLike,
  type TokenTradeChartSeriesBundle,
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

function createFakeTimeScale(): { timeScale: ChartTimeScaleLike; scrollToRealTimeCalls: () => number } {
  let visibleRange: { from: number; to: number } | null = { from: 0, to: 10 };
  let scrollToRealTimeCalls = 0;
  const timeScale: ChartTimeScaleLike = {
    scrollToRealTime: () => {
      scrollToRealTimeCalls += 1;
    },
    getVisibleLogicalRange: () => visibleRange,
    setVisibleLogicalRange: (range) => {
      visibleRange = range;
    },
  };
  return { timeScale, scrollToRealTimeCalls: () => scrollToRealTimeCalls };
}

type FakeChart = {
  bundle: TokenTradeChartSeriesBundle;
  candle: ReturnType<typeof createFakeSeries<ReturnType<typeof pointToSeriesDatum>>>;
  ma20: ReturnType<typeof createFakeSeries<{ time: number; value: number }>>;
  ma50: ReturnType<typeof createFakeSeries<{ time: number; value: number }>>;
  volume: ReturnType<typeof createFakeSeries<{ time: number; value: number; color: string }>>;
  scrollToRealTimeCalls: () => number;
};

function createFakeChart(): FakeChart {
  const candle = createFakeSeries<ReturnType<typeof pointToSeriesDatum>>();
  const ma20 = createFakeSeries<{ time: number; value: number }>();
  const ma50 = createFakeSeries<{ time: number; value: number }>();
  const volume = createFakeSeries<{ time: number; value: number; color: string }>();
  const { timeScale, scrollToRealTimeCalls } = createFakeTimeScale();

  const bundle: TokenTradeChartSeriesBundle = {
    candleSeries: candle.series,
    ma20Series: ma20.series,
    ma50Series: ma50.series,
    volumeSeries: volume.series,
    timeScale,
  };

  return { bundle, candle, ma20, ma50, volume, scrollToRealTimeCalls };
}

const DECIMALS = 18;
const FIVE_MINUTES = 300;

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
    });
    applyTokenTradeChartUpdate(chart.bundle, state, {
      trades: [sell, buy],
      decimals: DECIMALS,
      interval: "5m",
      timeframe: "5m",
      nowUnixSeconds: FIVE_MINUTES * 3,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
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
    });
    expect(chart.candle.setDataCalls).toBe(1);
    expect(chart.candle.updateCalls).toBe(0);
    expect(chart.scrollToRealTimeCalls()).toBe(1);
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
    });
    applyTokenTradeChartUpdate(chart.bundle, state, {
      trades,
      decimals: DECIMALS,
      interval: "1h",
      timeframe: "1h",
      nowUnixSeconds: 0,
      startingPriceNativePerToken: null,
      launchedAtUnixSeconds: null,
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
    });

    // The forced resync must have called setData again rather than letting
    // the update() throw break the whole update.
    expect(chart.candle.setDataCalls).toBe(2);
  });
});
