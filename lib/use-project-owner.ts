"use client";

import { useSyncExternalStore } from "react";
import { ACCOUNT_WALLET_CHANGE_EVENT } from "@/lib/account-wallet-state";
import { currentProjectOwner } from "@/lib/token-project-storage";

// Per-wallet project scoping (6 Sep 2026): the owner whose saved-project
// partition is in play — the confirmed wallet's lower-cased address, or null
// with no wallet confirmed. Re-renders the subscriber the moment the wallet
// is confirmed, changed or disconnected in the Account panel (same tab, via
// ACCOUNT_WALLET_CHANGE_EVENT) or in another tab (the `storage` event), so a
// page can reload its project list for the new owner. Server-rendered HTML
// and the hydration pass see null; the client snapshot takes over after.

function subscribe(onChange: () => void): () => void {
  window.addEventListener(ACCOUNT_WALLET_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ACCOUNT_WALLET_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getServerSnapshot(): string | null {
  return null;
}

export function useProjectOwner(): string | null {
  return useSyncExternalStore(subscribe, currentProjectOwner, getServerSnapshot);
}
