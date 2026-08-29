"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, defineChain, formatEther, formatUnits, http, type Address } from "viem";
import { ERC20_MIN_ABI, HOODLUMS_BONDING_CURVE_HEADER_ABI } from "@/lib/bonding-curve-config";
import { computeBondingCurveGraduationStatus, type BondingCurveGraduationStatus } from "@/lib/bonding-curve-status";
import { ROBINHOOD_TESTNET, ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { TOKEN_TRADE_CONFIRMED_EVENT } from "@/lib/token-trade-events";

const chain = defineChain({
  id: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
  name: ROBINHOOD_TESTNET.chainName,
  nativeCurrency: ROBINHOOD_TESTNET.nativeCurrency,
  rpcUrls: { default: { http: [...ROBINHOOD_TESTNET.rpcUrls] } },
  testnet: true,
});

export type TokenCurveStatus =
  | { kind: "no-address" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "wrong-token" }
  | {
      kind: "ready";
      curve: Address;
      creator: Address;
      graduation: BondingCurveGraduationStatus;
      remainingToGraduateWei: bigint;
      /** Native currency per whole token, derived from the curve's initial virtual reserves — used before any trade exists. */
      startingPriceNativePerToken: number;
      totalSupplyRaw: bigint;
    };

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Curve state unavailable.";
}

/**
 * The single shared on-chain curve-status poll for the whole token page
 * (issue #444): called exactly once, in `token-page-view.tsx`, and its
 * `TokenCurveStatus` result is passed down as a prop to both
 * `TokenHeaderBand` and `TokenLeftColumn`'s swap panel — previously each
 * maintained its own independent 12s poller against the same curve, which
 * doubled RPC/API load and let the header and swap panel show
 * momentarily different graduation/price data between polls. Uses a
 * dedicated ABI (`HOODLUMS_BONDING_CURVE_HEADER_ABI`) that is a superset of
 * what the swap panel needs (it also reads `token`, the initial virtual
 * reserves and total supply for the header's starting-price/market-cap
 * figures) so one read covers both consumers.
 */
export function useTokenCurveStatus(
  tokenAddress: string,
  curveAddress: Address | null,
  decimals: number,
): TokenCurveStatus {
  const [status, setStatus] = useState<TokenCurveStatus>(curveAddress ? { kind: "loading" } : { kind: "no-address" });

  const load = useCallback(
    async (curve: Address) => {
      setStatus({ kind: "loading" });
      try {
        const publicClient = createPublicClient({ chain, transport: http(ROBINHOOD_TESTNET.rpcUrls[0]) });
        const [
          token,
          funded,
          graduated,
          realNativeReserve,
          graduationTarget,
          liquidityPool,
          remainingToGraduate,
          creator,
          initialVirtualTokenReserve,
          initialVirtualEthReserve,
          totalSupplyRaw,
        ] = await Promise.all([
          publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_HEADER_ABI, functionName: "token" }),
          publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_HEADER_ABI, functionName: "funded" }),
          publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_HEADER_ABI, functionName: "graduated" }),
          publicClient.readContract({
            address: curve,
            abi: HOODLUMS_BONDING_CURVE_HEADER_ABI,
            functionName: "realNativeReserve",
          }),
          publicClient.readContract({
            address: curve,
            abi: HOODLUMS_BONDING_CURVE_HEADER_ABI,
            functionName: "graduationTarget",
          }),
          publicClient.readContract({
            address: curve,
            abi: HOODLUMS_BONDING_CURVE_HEADER_ABI,
            functionName: "liquidityPool",
          }),
          publicClient.readContract({
            address: curve,
            abi: HOODLUMS_BONDING_CURVE_HEADER_ABI,
            functionName: "remainingNativeToGraduate",
          }),
          publicClient.readContract({ address: curve, abi: HOODLUMS_BONDING_CURVE_HEADER_ABI, functionName: "creator" }),
          publicClient.readContract({
            address: curve,
            abi: HOODLUMS_BONDING_CURVE_HEADER_ABI,
            functionName: "initialVirtualTokenReserve",
          }),
          publicClient.readContract({
            address: curve,
            abi: HOODLUMS_BONDING_CURVE_HEADER_ABI,
            functionName: "initialVirtualEthReserve",
          }),
          publicClient.readContract({ address: tokenAddress as Address, abi: ERC20_MIN_ABI, functionName: "totalSupply" }),
        ]);

        if ((token as string).toLowerCase() !== tokenAddress.toLowerCase()) {
          setStatus({ kind: "wrong-token" });
          return;
        }

        const tokenReserveWhole = Number(formatUnits(initialVirtualTokenReserve, decimals));
        const startingPriceNativePerToken =
          tokenReserveWhole > 0 ? Number(formatEther(initialVirtualEthReserve)) / tokenReserveWhole : 0;

        setStatus({
          kind: "ready",
          curve,
          creator,
          graduation: computeBondingCurveGraduationStatus({
            funded,
            graduated,
            realNativeReserveWei: realNativeReserve,
            graduationTargetWei: graduationTarget,
            liquidityPool,
          }),
          remainingToGraduateWei: remainingToGraduate,
          startingPriceNativePerToken,
          totalSupplyRaw,
        });
      } catch (error) {
        setStatus({ kind: "error", message: readError(error) });
      }
    },
    [tokenAddress, decimals],
  );

  useEffect(() => {
    // load()'s first statement is a synchronous setStatus({kind:"loading"})
    // before its first await — the same load-on-mount shape
    // components/token-page/token-left-column.tsx's loadCurve already uses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (curveAddress) void load(curveAddress);
  }, [curveAddress, load]);

  // Live graduation/price data (matches lib/use-token-trades.ts's issue
  // #403 pattern): a visible-tab-only 12s timer, refetched immediately on
  // focus/visibilitychange, paused while the tab is hidden, and also
  // refetched immediately on TOKEN_TRADE_CONFIRMED_EVENT so the connected
  // wallet's own just-confirmed buy/sell updates the header and swap panel's
  // shared graduation/price state without waiting for the next tick — this
  // replaces token-left-column.tsx's old direct `loadCurve()` call in its
  // trade-confirm branch now that both consumers share this one poll.
  useEffect(() => {
    if (!curveAddress) return;
    const resolvedCurveAddress = curveAddress;
    let timer: number | null = null;

    function isPageVisible(): boolean {
      try {
        return document.visibilityState === "visible";
      } catch {
        return true;
      }
    }

    function startTimer() {
      if (timer !== null) return;
      timer = window.setInterval(() => void load(resolvedCurveAddress), 12_000);
    }

    function stopTimer() {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    }

    function handleBecameVisible() {
      if (!isPageVisible()) {
        stopTimer();
        return;
      }
      void load(resolvedCurveAddress);
      startTimer();
    }

    function handleTradeConfirmed() {
      void load(resolvedCurveAddress);
    }

    if (isPageVisible()) startTimer();
    document.addEventListener("visibilitychange", handleBecameVisible);
    window.addEventListener("focus", handleBecameVisible);
    window.addEventListener(TOKEN_TRADE_CONFIRMED_EVENT, handleTradeConfirmed);

    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleBecameVisible);
      window.removeEventListener("focus", handleBecameVisible);
      window.removeEventListener(TOKEN_TRADE_CONFIRMED_EVENT, handleTradeConfirmed);
    };
  }, [curveAddress, load]);

  return status;
}
