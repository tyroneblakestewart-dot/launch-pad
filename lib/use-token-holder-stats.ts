"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_TRADE_CONFIRMED_EVENT } from "@/lib/token-trade-events";
import type { TokenHolderBreakdown, TokenHolderStatsResponse } from "@/lib/token-holder-stats-types";
import type { SupportedChain } from "@/lib/types";

// Matches the server's own 60s cache (lib/server/token-holder-stats.ts) —
// polling faster would only ever re-read the same cached answer.
const POLL_INTERVAL_MS = 60_000;

/**
 * Live GET /api/token-holder-stats read for the Stats panel's Holder
 * breakdown rows (token page v2 part 3). Called exactly once, in
 * `token-page-view.tsx`, and passed down as a prop (the page's "fetch once
 * at the page, pass props" rule). Follows lib/use-token-trades.ts's issue
 * #403 live-refresh pattern: a visible-tab-only timer, an immediate refetch
 * on focus/visibilitychange and on the connected wallet's own just-confirmed
 * trade, silent in-place updates (never resets to "loading" on a background
 * refresh), and full cleanup on unmount. Only Robinhood Chain has a data
 * source today, so any other chain resolves to `null` with no fetch.
 *
 * `breakdown` is `null` until the first successful load and stays on the
 * last good value across a failed background poll; the panel renders `null`
 * as "—" for every row.
 */
export function useTokenHolderStats(chain: SupportedChain, tokenAddress: string) {
  const [breakdown, setBreakdown] = useState<TokenHolderBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabled = chain === "robinhood";
  const tokenRef = useRef(tokenAddress);
  const inFlightTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (tokenRef.current === tokenAddress) return;
    tokenRef.current = tokenAddress;
    setBreakdown(null);
    setError(null);
  }, [tokenAddress]);

  const load = useCallback(async () => {
    if (!enabled) return;
    const token = tokenRef.current;
    if (inFlightTokenRef.current === token) return;
    inFlightTokenRef.current = token;
    try {
      const response = await fetch(`/api/token-holder-stats?token=${token}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Holder stats request failed.");
      const body = (await response.json()) as TokenHolderStatsResponse;
      if (tokenRef.current !== token) return;
      setBreakdown(body.stats);
      setError(null);
    } catch {
      if (tokenRef.current !== token) return;
      setError("Could not load holder stats.");
    } finally {
      if (inFlightTokenRef.current === token) inFlightTokenRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load, tokenAddress]);

  useEffect(() => {
    if (!enabled) return;
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
      timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
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
      void load();
      startTimer();
    }

    function handleTradeConfirmed() {
      void load();
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
  }, [enabled, load, tokenAddress]);

  return { breakdown, error };
}
