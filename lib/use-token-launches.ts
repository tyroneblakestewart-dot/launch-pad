"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOKEN_LAUNCH_COMPLETED_EVENT } from "@/lib/token-launch-events";
import type { TokenLaunchGridFilter, TokenLaunchListItem } from "@/lib/token-launch-view";

const POLL_INTERVAL_MS = 30_000;

/**
 * Live-updating token_launches read for the homepage grid (issue #412 Part
 * 1), following components/support-hub.tsx's issue #403 live-refresh
 * pattern exactly: a visible-tab-only 30s timer, an immediate refetch on
 * focus/visibilitychange, and silent in-place updates (never resets to
 * "loading" on a background refresh). Also refetches immediately on
 * TOKEN_LAUNCH_COMPLETED_EVENT so a wallet's own just-completed launch
 * appears without a manual refresh. The rate limit this polling relies on
 * (TOKEN_LAUNCH_READ_LIMIT in lib/server/api-protection.ts) is already sized
 * for exactly this 30s-timer-plus-refocus shape.
 */
export function useTokenLaunches(filter: TokenLaunchGridFilter, limit = 24) {
  const [launches, setLaunches] = useState<TokenLaunchListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef(filter);
  const limitRef = useRef(limit);
  useEffect(() => {
    filterRef.current = filter;
    limitRef.current = limit;
  }, [filter, limit]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/token-launches?filter=${filterRef.current}&limit=${limitRef.current}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Token launches request failed.");
      const body = (await response.json()) as { launches: TokenLaunchListItem[] };
      setLaunches(body.launches);
      setError(null);
    } catch {
      setError("Could not load tokens. Try again shortly.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, filter, limit]);

  useEffect(() => {
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

    function handleLaunchCompleted() {
      void load();
    }

    if (isPageVisible()) startTimer();
    document.addEventListener("visibilitychange", handleBecameVisible);
    window.addEventListener("focus", handleBecameVisible);
    window.addEventListener(TOKEN_LAUNCH_COMPLETED_EVENT, handleLaunchCompleted);

    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleBecameVisible);
      window.removeEventListener("focus", handleBecameVisible);
      window.removeEventListener(TOKEN_LAUNCH_COMPLETED_EVENT, handleLaunchCompleted);
    };
  }, [load]);

  return { launches, error };
}
