/**
 * Signal fired the moment a wallet's own buy/sell on a bonding curve
 * confirms (issue #430 requirement 4: "on the connected user's own confirmed
 * trade, refetch immediately"). Mirrors lib/token-launch-events.ts's window
 * CustomEvent pattern so components/token-center-column.tsx's trade/chart
 * poll can refetch without a direct reference to the swap panel that
 * triggered it.
 */
export const TOKEN_TRADE_CONFIRMED_EVENT = "launchpad:token-trade-confirmed";

export type TokenTradeConfirmedDetail = Readonly<{
  curveAddress: string;
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
