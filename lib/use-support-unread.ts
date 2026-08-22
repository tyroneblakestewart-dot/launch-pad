"use client";

import { useEffect, useState } from "react";
import { ACCOUNT_WALLET_STORAGE_KEY, parseStoredAccountWallet } from "@/lib/account-wallet-state";
import { hasSupportTicketNews, readSupportLastSeen, type SupportUnreadTicket } from "@/lib/support-unread";

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

async function refreshSupportUnread(): Promise<void> {
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
      notify(hasSupportTicketNews(payload.tickets, readSupportLastSeen(wallet)));
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
