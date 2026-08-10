"use client";

import { useEffect, useState } from "react";
import {
  ACCOUNT_WALLET_CHANGE_EVENT,
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
} from "@/lib/account-wallet-state";
import type { SubscriptionAccess } from "@/lib/subscription-lifecycle";

export type SubscriptionStatusState = "checking" | "disconnected" | "ready" | "unavailable";

export type SubscriptionStatusView = {
  state: SubscriptionStatusState;
  walletAddress: string | null;
  access: SubscriptionAccess | null;
};

const INITIAL_VIEW: SubscriptionStatusView = {
  state: "checking",
  walletAddress: null,
  access: null,
};

function storedWalletAddress(): string | null {
  try {
    return parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY))?.account ?? null;
  } catch {
    return null;
  }
}

/**
 * Server-derived subscription status, same source of truth as the /social
 * gate (`/api/subscriptions/status`). `access` is only ever populated from a
 * successful server response, never a client-only flag, so callers must not
 * grant access before `state` reaches "ready".
 */
export function useSubscriptionStatus(): SubscriptionStatusView {
  const [view, setView] = useState<SubscriptionStatusView>(INITIAL_VIEW);

  useEffect(() => {
    let controller: AbortController | null = null;
    let requestVersion = 0;

    async function refresh() {
      controller?.abort();
      requestVersion += 1;
      const version = requestVersion;
      const walletAddress = storedWalletAddress();

      if (!walletAddress) {
        setView({ state: "disconnected", walletAddress: null, access: null });
        return;
      }

      controller = new AbortController();
      setView({ state: "checking", walletAddress, access: null });

      try {
        const response = await fetch(
          `/api/subscriptions/status?wallet=${encodeURIComponent(walletAddress)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error("Subscription status could not be checked.");
        }

        const access = (await response.json()) as SubscriptionAccess;
        if (typeof access?.active !== "boolean") {
          throw new Error("Subscription status response was invalid.");
        }
        if (version !== requestVersion || controller.signal.aborted) return;

        setView({ state: "ready", walletAddress, access });
      } catch {
        if (version !== requestVersion || controller?.signal.aborted) return;
        setView({ state: "unavailable", walletAddress, access: null });
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === ACCOUNT_WALLET_STORAGE_KEY) {
        void refresh();
      }
    }

    void refresh();
    window.addEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      requestVersion += 1;
      controller?.abort();
      window.removeEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return view;
}
