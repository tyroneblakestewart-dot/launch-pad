// Shape GET /api/token-trades returns (issue #430): one normalized row per
// on-chain TokensPurchased/TokensSold event, ascending by block/log order
// (oldest first) — callers reverse for a "newest first" list and use the
// ascending order directly for candle bucketing. bigint on-chain values are
// serialised as decimal strings since JSON has no bigint type.

export type TokenTradeDirection = "buy" | "sell";

export type TokenTradeItem = {
  direction: TokenTradeDirection;
  /** Lowercased buyer/seller address. */
  wallet: string;
  /** Raw token amount (the token's own decimals), as a decimal string. */
  tokenAmountRaw: string;
  /** Gross native currency amount moved (before the 1% trading fee), in wei, as a decimal string. */
  nativeAmountWei: string;
  /** nativeAmountWei / 1e18 divided by tokenAmountRaw / 10**decimals — a plain number for display and charting. */
  priceNativePerToken: number;
  blockNumber: string;
  blockTimestampMs: number;
  txHash: string;
  logIndex: number;
};
