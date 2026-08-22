"use client";

import { useEffect, useState } from "react";
import { ACCOUNT_WALLET_STORAGE_KEY, parseStoredAccountWallet } from "@/lib/account-wallet-state";
import {
  hasSupportTicketNews,
  readSupportLastSeen,
  writeSupportLastSeen,
  type SupportUnreadTicket,
} from "@/lib/support-unread";

// Nav-wide red-dot check (issue #403). AppNavigation and MobileBottomNavigation
// are both always mounted (CSS just hides whichever doesn't match the current
// viewport — see app/(app)/layout.tsx), so this hook is a tiny module-level
// singleton rather than per-component state: every subscriber shares one
// cached value and one in-flight fetch, so two nav surfaces checking on the
// same mount/focus never double the request count against SUPPORT_READ_LIMIT.
// Per the issue: page-load and window-focus only — no polling timer here (the
// 60s timer belongs to the /support page itself, in components/support-hub.tsx).

function storedWalletAddress(): string {
  try {
    return parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY))?.account ?? "";
  } catch {
    return "";
  }
}

let cachedUnread = false;
const listeners = new Set<(value: boolean) => void>();
let inFlight: Promise<void> | null = null;

function notify(value: boolean): void {
  cachedUnread = value;
  listeners.forEach((listener) => listener(value));
}

// In-memory, per-wallet fallback for this module's last-seen boundary
// (issue #405 review) — a Safari private-mode/quota-exceeded write can fail
// silently in lib/support-unread.ts's best-effort localStorage write, and
// without this, the *next* check would fall back to the stale persisted
// value and relight a dot that was already marked seen this session. Never
// persisted itself, never a source of truth across page loads — purely a
// same-session guard against relighting.
const inMemoryLastSeenFallback = new Map<string, number>();

function effectiveLastSeen(walletAddress: string): number {
  const key = walletAddress.toLowerCase();
  const persisted = readSupportLastSeen(walletAddress);
  const inMemory = inMemoryLastSeenFallback.get(key) ?? 0;
  return Math.max(persisted, inMemory);
}

function rememberLastSeenInMemory(walletAddress: string, timestampMs: number): void {
  const key = walletAddress.toLowerCase();
  const current = inMemoryLastSeenFallback.get(key) ?? 0;
  if (timestampMs > current) inMemoryLastSeenFallback.set(key, timestampMs);
}

/**
 * Exported (issue #405) so a test can exercise the real fetch → hasSupportTicketNews
 * → notify → listeners path directly — this repo's Vitest suite runs in a
 * plain Node environment with no jsdom/@testing-library, so a mounted
 * `useSupportUnread()` component tree isn't available to test against; this
 * is the closest "real component-level end-to-end-ish" seam that
 * environment allows. Not part of the hook's public contract otherwise.
 */
export async function refreshSupportUnread(): Promise<void> {
  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    const wallet = storedWalletAddress();
    if (!wallet) {
      notify(false);
      return;
    }

    try {
      const response = await fetch(`/api/support/tickets?walletAddress=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      if (!response.ok) {
        // Never a false alert on a failed or rate-limited check.
        notify(false);
        return;
      }
      const payload = (await response.json().catch(() => null)) as { tickets?: SupportUnreadTicket[] } | null;
      if (!payload || !Array.isArray(payload.tickets)) {
        notify(false);
        return;
      }
      notify(hasSupportTicketNews(payload.tickets, effectiveLastSeen(wallet)));
    } catch {
      notify(false);
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Called by SupportHub.loadTickets after every successful signed-wallet
 * ticket-list response (issue #405 review) — clears the dot the moment that
 * wallet's current data is on screen, rather than waiting for the nav's next
 * mount/focus check to independently refetch and notice.
 *
 * The seen boundary is the newest *observed* ticket activity timestamp
 * (`SupportUnreadTicket.updatedAt`), never `Date.now()`: wall-clock write
 * time would incorrectly mark as "seen" any owner activity that lands in the
 * gap between this response being fetched and this call running, hiding a
 * real notification. It's also monotonic against whatever was already
 * recorded (persisted or in-memory) so a call can never move the boundary
 * backwards.
 *
 * Writes are per-wallet (`writeSupportLastSeen`/`inMemoryLastSeenFallback`
 * are both keyed by `walletAddress`), so marking wallet A seen never touches
 * wallet B's cached state. The shared `notify()` — which drives the single
 * nav-wide `cachedUnread` value — only fires when `walletAddress` matches
 * the wallet currently active in this browser (mirroring
 * `refreshSupportUnread`'s own `storedWalletAddress()` check), so a stale or
 * out-of-order call for a wallet that's no longer active can't flip the dot
 * for whichever wallet the user has since switched to.
 */
export function markSupportUnreadSeen(walletAddress: string, observedTickets: SupportUnreadTicket[]): void {
  if (!walletAddress) return;
  const newestObservedMs = observedTickets.reduce((max, ticket) => {
    const updatedMs = Date.parse(ticket.updatedAt);
    return Number.isFinite(updatedMs) && updatedMs > max ? updatedMs : max;
  }, effectiveLastSeen(walletAddress));

  writeSupportLastSeen(walletAddress, newestObservedMs);
  // Remembered unconditionally, regardless of whether the localStorage write
  // above actually succeeded — see the module-level doc comment above.
  rememberLastSeenInMemory(walletAddress, newestObservedMs);

  if (storedWalletAddress().toLowerCase() === walletAddress.toLowerCase()) {
    notify(hasSupportTicketNews(observedTickets, newestObservedMs));
  }
}

/** Test-only seam: reads the current cached value without subscribing a component (issue #405). */
export function getCachedSupportUnreadForTests(): boolean {
  return cachedUnread;
}

/** Test-only seam: resets this module's singleton state between tests (issue #405). */
export function resetSupportUnreadForTests(): void {
  cachedUnread = false;
  listeners.clear();
  inFlight = null;
  inMemoryLastSeenFallback.clear();
}

export function useSupportUnread(): boolean {
  const [unread, setUnread] = useState(cachedUnread);

  useEffect(() => {
    // useState(cachedUnread) above already captures the current value at
    // mount time, so no resync call is needed here before subscribing.
    listeners.add(setUnread);
    void refreshSupportUnread();

    function handleFocus() {
      void refreshSupportUnread();
    }
    window.addEventListener("focus", handleFocus);

    return () => {
      listeners.delete(setUnread);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return unread;
}
