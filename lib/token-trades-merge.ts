import type { TokenTrade } from "./token-trade-types";

// Pure keyed-merge logic behind lib/use-token-trades.ts's in-place live
// updates (issue #445). Kept dependency-free of React so the "identical poll
// never changes the array reference" guarantee is directly unit-testable
// without rendering the hook.

/** A trade's stable identity across polls: one on-chain event, one key. */
export function tokenTradeKey(trade: TokenTrade): string {
  return `${trade.txHash}:${trade.logIndex}`;
}

/**
 * Merges a freshly-fetched trade list into the previously held one. Returns
 * the exact same `previous` array reference when `incoming` contains no
 * trade `previous` didn't already have — the caller must skip `setState`
 * entirely in that case so a poll that finds nothing new never triggers a
 * re-render of the chart or any other consumer. When there are genuinely new
 * trades, they're folded in and the result re-sorted newest-first (matching
 * lib/server/token-trades-rpc.ts's own ordering); every previously-held trade
 * object is preserved as-is, never recreated.
 */
export function mergeTokenTrades(previous: TokenTrade[], incoming: TokenTrade[]): TokenTrade[] {
  if (previous.length === 0) return incoming;

  const previousKeys = new Set(previous.map(tokenTradeKey));
  const newTrades = incoming.filter((trade) => !previousKeys.has(tokenTradeKey(trade)));
  if (newTrades.length === 0) return previous;

  return [...newTrades, ...previous].sort(
    (a, b) => b.blockTimestamp - a.blockTimestamp || b.logIndex - a.logIndex,
  );
}
