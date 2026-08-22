"use client";

import { useEffect, useState } from "react";
import {
  hasAdminSupportNews,
  maxAdminSupportActivityMs,
  readAdminSupportLastSeen,
  writeAdminSupportLastSeen,
  type AdminSupportActivityTicket,
} from "@/lib/admin-support-unread";

// /admin Support tab red-dot check (issue #405). Mirrors
// lib/use-support-unread.ts's module-level singleton shape (one cached
// value, one in-flight fetch, subscriber set) so multiple mounts of
// AdminDashboard never double the request count. Checked on initial /admin
// load and window focus only — no new polling beyond the dashboard's
// existing 30s operations refresh, which is a different endpoint on a
// different cadence and is deliberately not reused here.

let cachedUnread = false;
const listeners = new Set<(value: boolean) => void>();
let inFlight: Promise<void> | null = null;

function notify(value: boolean): void {
  cachedUnread = value;
  listeners.forEach((listener) => listener(value));
}

// In-memory fallback for the admin last-seen boundary (issue #405 review) —
// a Safari private-mode/quota-exceeded localStorage write can fail silently
// in lib/admin-support-unread.ts's best-effort write; without this, the next
// check would fall back to the stale persisted value and relight a dot that
// was already marked seen this session. There's exactly one admin owner
// using /admin, so this is a single value rather than the per-wallet map the
// user-side hook needs. Never persisted itself, never a source of truth
// across page loads.
let inMemoryLastSeenFallback = 0;

function effectiveAdminLastSeen(): number {
  return Math.max(readAdminSupportLastSeen(), inMemoryLastSeenFallback);
}

function rememberAdminLastSeenInMemory(timestampMs: number): void {
  if (timestampMs > inMemoryLastSeenFallback) inMemoryLastSeenFallback = timestampMs;
}

/**
 * Exported (issue #405) so a test can exercise the real fetch →
 * hasAdminSupportNews → notify → listeners path directly, mirroring
 * lib/use-support-unread.ts's exported refreshSupportUnread — this repo's
 * Vitest suite has no jsdom/@testing-library, so a mounted
 * `useAdminSupportUnread()` component tree isn't available to test against.
 * Not part of the hook's public contract otherwise.
 */
export async function refreshAdminSupportUnread(): Promise<void> {
  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    try {
      const response = await fetch("/api/admin/support?status=all", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        // A failed, unauthenticated or rate-limited check must not silently
        // clear a true notification (issue #405 review) — leave whatever's
        // already cached alone rather than notify(false).
        return;
      }
      const payload = (await response.json().catch(() => null)) as { tickets?: AdminSupportActivityTicket[] } | null;
      if (!payload || !Array.isArray(payload.tickets)) return;
      notify(hasAdminSupportNews(payload.tickets, effectiveAdminLastSeen()));
    } catch {
      // Preserve the existing cached dot on a network failure too.
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Called once the Support section's own listing has loaded successfully
 * (issue #405) — clears the dot immediately, the moment current support data
 * has actually been observed, rather than waiting for the next focus/mount
 * check. `observedTickets` is that same listing response: the seen boundary
 * is derived from the newest ticket/user-message activity actually in it
 * (`maxAdminSupportActivityMs`), never `Date.now()` — a wall-clock write
 * would incorrectly mark as "seen" any activity that lands in the gap
 * between this response being fetched and this call running.
 */
export function markAdminSupportSeen(observedTickets: AdminSupportActivityTicket[]): void {
  const newestObservedMs = Math.max(effectiveAdminLastSeen(), maxAdminSupportActivityMs(observedTickets));
  writeAdminSupportLastSeen(newestObservedMs);
  // Remembered unconditionally, regardless of whether the localStorage write
  // above actually succeeded — see the module-level doc comment above.
  rememberAdminLastSeenInMemory(newestObservedMs);
  notify(false);
}

/** Test-only seam: reads the current cached value without subscribing a component (issue #405). */
export function getCachedAdminSupportUnreadForTests(): boolean {
  return cachedUnread;
}

/** Test-only seam: resets this module's singleton state between tests (issue #405). */
export function resetAdminSupportUnreadForTests(): void {
  cachedUnread = false;
  listeners.clear();
  inFlight = null;
  inMemoryLastSeenFallback = 0;
}

export function useAdminSupportUnread(): boolean {
  const [unread, setUnread] = useState(cachedUnread);

  useEffect(() => {
    listeners.add(setUnread);
    void refreshAdminSupportUnread();

    function handleFocus() {
      void refreshAdminSupportUnread();
    }
    window.addEventListener("focus", handleFocus);

    return () => {
      listeners.delete(setUnread);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return unread;
}
