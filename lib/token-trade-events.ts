/**
 * Signal fired when a wallet's own buy/sell on a bonding curve has just
 * confirmed (issue #430, extending #412 Part 1's
 * lib/token-launch-events.ts pattern and #427's existing post-trade
 * curve/balance refetch): lets the Recent trades tab and the chart refetch
 * immediately instead of waiting for the next ~12s poll tick.
 */
export const TOKEN_TRADE_CONFIRMED_EVENT = "launchpad:token-trade-confirmed";

export type TokenTradeConfirmedDetail = Readonly<{
  curveAddress: string;
  chainId: number;
}>;

export function notifyTokenTradeConfirmed(
  detail: TokenTradeConfirmedDetail,
  target?: EventTarget,
): void {
  const eventTarget = target ?? (typeof window === "undefined" ? null : window);
  if (!eventTarget) return;

  eventTarget.dispatchEvent(
    new CustomEvent<TokenTradeConfirmedDetail>(TOKEN_TRADE_CONFIRMED_EVENT, { detail }),
  );
}
