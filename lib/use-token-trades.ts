"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_TRADE_CONFIRMED_EVENT } from "@/lib/token-trade-events";
import type { TokenTradeItem } from "@/lib/token-trade-view";

const POLL_INTERVAL_MS = 12_000;

/**
 * Live-updating read of GET /api/token-trades for the token page's Recent
 * trades tab and candlestick chart (issue #430), following
 * lib/use-token-launches.ts's issue #412/#403 live-refresh pattern exactly:
 * a visible-tab-only ~12s timer, an immediate refetch on focus/
 * visibilitychange, and silent in-place updates (never resets to a loading
 * state on a background refresh). Also refetches immediately on
 * TOKEN_TRADE_CONFIRMED_EVENT so the connected wallet's own just-confirmed
 * trade appears without waiting for the next poll tick. `trades` stays
 * `null` (not `[]`) until the first successful load, so callers can tell
 * "still loading" apart from a genuine zero-trades empty state; `error` is
 * set (independent of `trades`, which keeps its last known value) when a
 * read fails, so a read failure never gets mistaken for "no trades".
 */
export function useTokenTrades(curveAddress: string | null, chainId: number) {
  const [trades, setTrades] = useState<TokenTradeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const curveRef = useRef(curveAddress);
  const chainIdRef = useRef(chainId);
  useEffect(() => {
    curveRef.current = curveAddress;
    chainIdRef.current = chainId;
  }, [curveAddress, chainId]);

  const load = useCallback(async () => {
    const curve = curveRef.current;
    if (!curve) {
      setTrades([]);
      setError(null);
      return;
    }
    try {
      const response = await fetch(
        `/api/token-trades?curve=${encodeURIComponent(curve)}&chainId=${chainIdRef.current}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Token trades request failed.");
      const body = (await response.json()) as { trades: TokenTradeItem[] };
      setTrades(body.trades);
      setError(null);
    } catch {
      setError("Could not load trade history. Retrying…");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, curveAddress, chainId]);

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

  return { trades, error };
}
