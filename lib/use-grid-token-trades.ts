"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TokenTrade } from "@/lib/token-trade-types";

const POLL_INTERVAL_MS = 60_000;

/**
 * Live-updating GET /api/token-trades read for a homepage grid card's mini
 * chart (issue #436) — the same route and response shape
 * lib/use-token-trades.ts already polls for the token page, reused rather
 * than a second trade-reading path, but at a much slower ~60s cadence (the
 * token page's 12s poll stays the fast path) and gated behind `active` so a
 * card that's scrolled off screen (lib/use-in-view.ts) neither fetches nor
 * polls. Follows the same issue #403 live-refresh shape as its sibling
 * hooks: a visible-tab-only timer, an immediate refetch on focus/
 * visibilitychange while active, and silent in-place updates. A route
 * failure (including a 429 from the shared per-IP trade-read rate limit)
 * just leaves `trades` at its last-known value/null — the caller's pure
 * sparkline builder already renders a flat baseline for that, so one busy
 * card degrading gracefully can never break the surrounding grid.
 */
export function useGridTokenTrades(curveAddress: string, active: boolean) {
  const [trades, setTrades] = useState<TokenTrade[] | null>(null);
  const curveRef = useRef(curveAddress);
  useEffect(() => {
    curveRef.current = curveAddress;
  }, [curveAddress]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/token-trades?curve=${curveRef.current}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { trades: TokenTrade[] };
      setTrades(body.trades);
    } catch {
      // Silent: the pure sparkline builder already renders a flat baseline
      // for a null/stale trades list, matching this hook's "degrade quietly"
      // contract.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, curveAddress, load]);

  useEffect(() => {
    if (!active) return;
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

    if (isPageVisible()) startTimer();
    document.addEventListener("visibilitychange", handleBecameVisible);
    window.addEventListener("focus", handleBecameVisible);

    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleBecameVisible);
      window.removeEventListener("focus", handleBecameVisible);
    };
  }, [active, load]);

  return { trades };
}
