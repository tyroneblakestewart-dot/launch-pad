import type { Address, Hash } from "viem";

// Shared shape for a single normalized bonding-curve trade (issue #430),
// produced server-side from contracts/HoodlumsTestBondingCurve.sol's
// TokensPurchased/TokensSold events (lib/server/token-trades-rpc.ts) and
// consumed by both the Recent trades tab and the candlestick chart so they
// stay in lockstep off one shared fetch. Amounts stay raw (wei/base-unit
// strings) rather than pre-formatted numbers so precision is never lost in
// transit; `nativeAmountRaw` is deliberately the post-fee amount (netNativeIn
// for a buy, netNativeOut for a sell) since that's what actually priced the
// trade against the curve's reserves, matching the curve's own quoting math.

export type TokenTradeDirection = "buy" | "sell";

export type TokenTrade = {
  direction: TokenTradeDirection;
  wallet: Address;
  tokenAmountRaw: string;
  nativeAmountRaw: string;
  blockNumber: string;
  blockTimestamp: number;
  txHash: Hash;
  logIndex: number;
  /**
   * Gross native amount (grossNativeIn for a buy, grossNativeOut for a
   * sell) — issue #443 part 1's Stats panel needs the gross side for sell
   * volume specifically, distinct from `nativeAmountRaw`'s post-fee amount.
   * Optional so every pre-existing trade fixture across this repo's test
   * suite keeps compiling unchanged; real reads always populate it.
   */
  grossNativeAmountRaw?: string;
  /** Protocol fee charged on this trade, in wei. Optional for the same reason as `grossNativeAmountRaw`. */
  feeChargedRaw?: string;
  /**
   * The curve's own virtual token/ETH reserves immediately after this trade
   * (issue #458) — both events emit these already. This, not
   * nativeAmount÷tokenAmount (the trade's own AVERAGE price), is where the
   * curve actually lands post-trade, so every price shown or bucketed
   * (lib/candle-bucketing.ts's `tradeSpotPriceNativePerToken`) derives from
   * these two fields. Optional for the same reason as `grossNativeAmountRaw`.
   */
  virtualTokenReserveRaw?: string;
  virtualEthReserveRaw?: string;
  /**
   * Which market this trade executed on (issue #466): "curve" for a
   * bonding-curve buy/sell, "pool" for a post-graduation Uniswap V3 swap on
   * the locked liquidity pool. Optional, defaulting to "curve" wherever
   * unset, so every pre-existing trade fixture across this repo's test
   * suite keeps compiling unchanged.
   */
  venue?: "curve" | "pool";
  /**
   * A pool swap's own explicit spot price (native wei per whole token),
   * derived server-side from the Swap event's sqrtPriceX96
   * (lib/uniswap-v3-spot-price.ts) — a bonding curve has no equivalent
   * on-event price, so this is only ever set for `venue: "pool"` trades.
   * `tradeSpotPriceNativePerToken` (lib/candle-bucketing.ts) prefers this
   * value when present, falling back to the reserve-based derivation
   * otherwise.
   */
  spotPriceNativePerTokenRaw?: string;
};

export type TokenTradesResponse = { trades: TokenTrade[] };
