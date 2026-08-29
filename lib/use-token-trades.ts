"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeTokenTrades } from "@/lib/token-trades-merge";
import { TOKEN_TRADE_CONFIRMED_EVENT } from "@/lib/token-trade-events";
import type { TokenTrade } from "@/lib/token-trade-types";

const POLL_INTERVAL_MS = 12_000;

/**
 * Live-updating GET /api/token-trades read, shared by the Recent trades tab
 * and the candlestick chart (issue #430 requirement 4: "one shared poll for
 * chart and trades tab, not two"). Follows lib/use-token-launches.ts's issue
 * #403 live-refresh pattern exactly: a visible-tab-only 12s timer, an
 * immediate refetch on focus/visibilitychange, and silent in-place updates
 * (never resets to "loading" on a background refresh). Also refetches
 * immediately on TOKEN_TRADE_CONFIRMED_EVENT so the connected wallet's own
 * just-confirmed trade appears without a manual refresh. `curveAddress` of
 * `null` (no curve resolved/deployed for this token) resolves to an empty
 * trade list with no fetch and no polling — there is nothing to read yet.
 *
 * Issue #445's in-place live updates: `tradesRef` holds the last merged
 * array so every poll can be folded through `mergeTokenTrades` (keyed by tx
 * hash + log index) instead of replacing the array wholesale. When a poll
 * finds nothing new, `merged` comes back as the exact same reference already
 * in state, so `setTrades` is skipped entirely — no re-render ripples out to
 * the chart or the header's shared price. `stale` distinguishes "a poll
 * failed after data had already loaded" (last-known candles/trades stay on
 * screen, banner shown) from `error` ("never successfully loaded a single
 * time" — the only case where there's nothing sensible to keep showing).
 */
export function useTokenTrades(curveAddress: string | null) {
  const [trades, setTrades] = useState<TokenTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const curveRef = useRef(curveAddress);
  const tradesRef = useRef<TokenTrade[] | null>(null);
  useEffect(() => {
    curveRef.current = curveAddress;
  }, [curveAddress]);

  const load = useCallback(async () => {
    const curve = curveRef.current;
    if (!curve) {
      tradesRef.current = [];
      setTrades([]);
      setError(null);
      setStale(false);
      return;
    }
    try {
      const response = await fetch(`/api/token-trades?curve=${curve}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Trade history request failed.");
      const body = (await response.json()) as { trades: TokenTrade[] };

      const previousTrades = tradesRef.current;
      const merged = previousTrades === null ? body.trades : mergeTokenTrades(previousTrades, body.trades);
      if (merged !== previousTrades) {
        tradesRef.current = merged;
        setTrades(merged);
      }
      setError(null);
      setStale(false);
    } catch {
      if (tradesRef.current === null) {
        setError("Could not load trade history. Try again shortly.");
      } else {
        setStale(true);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, curveAddress]);

  useEffect(() => {
    if (!curveAddress) return;
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
  }, [curveAddress, load]);

  return { trades, error, stale, retry: load };
}
