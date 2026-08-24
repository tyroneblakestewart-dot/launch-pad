/**
 * Signal fired when a wallet's own on-chain token launch has just been
 * recorded server-side (issue #412 Part 1: "after the user's own launch
 * completes, trigger an immediate refetch so their token visibly appears
 * without a manual refresh"). Mirrors lib/workspace-open-request.ts's
 * window CustomEvent pattern so the homepage grid can listen without the
 * launch surfaces (the studio modal, /testnet) needing a direct reference
 * to the grid component.
 */
export const TOKEN_LAUNCH_COMPLETED_EVENT = "launchpad:token-launch-completed";

export type TokenLaunchCompletedDetail = Readonly<{
  tokenAddress: string;
  chainId: number;
}>;

export function notifyTokenLaunchCompleted(
  detail: TokenLaunchCompletedDetail,
  target?: EventTarget,
): void {
  const eventTarget = target ?? (typeof window === "undefined" ? null : window);
  if (!eventTarget) return;

  eventTarget.dispatchEvent(
    new CustomEvent<TokenLaunchCompletedDetail>(TOKEN_LAUNCH_COMPLETED_EVENT, { detail }),
  );
}
