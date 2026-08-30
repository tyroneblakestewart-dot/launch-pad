import { formatEther } from "viem";
import { tradeSpotPriceNativePerToken } from "./candle-bucketing";
import type { TokenTrade } from "./token-trade-types";

// Pure aggregation over the trades useTokenTrades already holds, for the
// token page v2 Stats panel (issue #443 part 1 item 5) — deliberately NO
// second fetch/route, per design/token-page-v2/token-page-data-inventory.md
// section 8: "the trades route is rate-limited and shared with everything
// else."

export type TradeStatsWindowKey = "5m" | "1h" | "24h";

export const TRADE_STATS_WINDOW_SECONDS: Record<TradeStatsWindowKey, number> = {
  "5m": 5 * 60,
  "1h": 60 * 60,
  "24h": 24 * 60 * 60,
};

export const TRADE_STATS_WINDOWS: readonly TradeStatsWindowKey[] = ["5m", "1h", "24h"];

/**
 * Wraps `Date.now()` behind a named function so call sites in components
 * don't call it inline — React's purity lint rule (react-hooks/purity)
 * flags a direct `Date.now()` call in a component body as an impure
 * render, matching lib/token-page-format.ts's `formatTimeAgoSeconds`/
 * `formatLaunchAge`, which already hide the same call the same way.
 */
export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export type TradeWindowStats = {
  priceChangePercent: number;
  volumeNative: number;
  buys: number;
  sells: number;
  buyVolumeNative: number;
  sellVolumeNative: number;
  buyers: number;
  sellers: number;
};

function nativeAmount(raw: string | undefined): number {
  if (!raw) return 0;
  try {
    return Number(formatEther(BigInt(raw)));
  } catch {
    return 0;
  }
}

/**
 * Aggregates trades that fall inside the trailing `windowSeconds` window
 * (relative to `nowUnixSeconds`). Buy/sell volume follow the inventory's
 * definitions exactly: buy volume sums each buy's post-fee native-in
 * (`nativeAmountRaw`, already net for a buy — see lib/token-trade-types.ts),
 * sell volume sums each sell's gross native-out (`grossNativeAmountRaw`) —
 * the two are deliberately not the same accounting basis. Price change
 * compares the first and last trade chronologically inside the window; with
 * fewer than two trades in the window it's 0, matching the "New token: 0.0%"
 * fallback.
 */
export function computeTradeWindowStats(
  trades: TokenTrade[],
  windowSeconds: number,
  decimals: number,
  nowUnixSeconds: number,
): TradeWindowStats {
  const cutoff = nowUnixSeconds - windowSeconds;
  const inWindow = trades
    .filter((trade) => trade.blockTimestamp >= cutoff)
    .sort((a, b) => a.blockTimestamp - b.blockTimestamp || a.logIndex - b.logIndex);

  let buys = 0;
  let sells = 0;
  let buyVolumeNative = 0;
  let sellVolumeNative = 0;
  const buyers = new Set<string>();
  const sellers = new Set<string>();

  for (const trade of inWindow) {
    if (trade.direction === "buy") {
      buys += 1;
      buyVolumeNative += nativeAmount(trade.nativeAmountRaw);
      buyers.add(trade.wallet.toLowerCase());
    } else {
      sells += 1;
      sellVolumeNative += nativeAmount(trade.grossNativeAmountRaw);
      sellers.add(trade.wallet.toLowerCase());
    }
  }

  let priceChangePercent = 0;
  if (inWindow.length >= 2) {
    const firstPrice = tradeSpotPriceNativePerToken(inWindow[0], decimals);
    const lastPrice = tradeSpotPriceNativePerToken(inWindow[inWindow.length - 1], decimals);
    if (firstPrice > 0) priceChangePercent = ((lastPrice - firstPrice) / firstPrice) * 100;
  }

  return {
    priceChangePercent,
    volumeNative: buyVolumeNative + sellVolumeNative,
    buys,
    sells,
    buyVolumeNative,
    sellVolumeNative,
    buyers: buyers.size,
    sellers: sellers.size,
  };
}

/**
 * Lifetime protocol fees across every currently-loaded trade — deliberately
 * NOT filtered by the Stats panel's TF selector (the inventory calls this
 * out explicitly: "Not affected by TF or Price/MCap").
 */
export function computeTotalFeesNative(trades: TokenTrade[]): number {
  return trades.reduce((sum, trade) => sum + nativeAmount(trade.feeChargedRaw), 0);
}
