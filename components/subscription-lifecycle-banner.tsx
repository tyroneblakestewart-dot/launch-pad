"use client";

import { useEffect, useState } from "react";
import {
  ACCOUNT_WALLET_CHANGE_EVENT,
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
} from "@/lib/account-wallet-state";
import { storeLaunchPathPreset } from "@/lib/launch-paths";
import {
  subscriptionPlanLabel,
  type SubscriptionAccess,
} from "@/lib/subscription-lifecycle";
import { requestWorkspaceOpen } from "@/lib/workspace-open-request";
import styles from "./subscription-lifecycle-banner.module.css";

function storedWalletAddress(): string | null {
  return parseStoredAccountWallet(
    localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY),
  )?.account ?? null;
}

export function SubscriptionLifecycleBanner() {
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;

    function refresh() {
      controller?.abort();
      const wallet = storedWalletAddress();
      if (!wallet) {
        setAccess(null);
        return;
      }
      controller = new AbortController();
      fetch(`/api/subscriptions/status?wallet=${encodeURIComponent(wallet)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((next: SubscriptionAccess | null) => setAccess(next?.plan ? next : null))
        .catch(() => {
          if (!controller?.signal.aborted) setAccess(null);
        });
    }

    refresh();
    const interval = window.setInterval(refresh, 5 * 60 * 1_000);
    window.addEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (!access?.plan || access.status === "active") return null;

  const label = subscriptionPlanLabel(access.plan);
  const message = access.status === "expired"
    ? `Your ${label} has expired — renew to unlock your features. Your data is safe.`
    : `Your ${label} expires in ${access.daysRemaining} ${access.daysRemaining === 1 ? "day" : "days"} — renew now.`;

  function renew() {
    if (!access?.plan) return;
    if (window.location.pathname === "/") {
      requestWorkspaceOpen("new", access.plan);
      return;
    }
    storeLaunchPathPreset(access.plan);
    window.location.assign("/");
  }

  return (
    <aside className={styles.banner} data-status={access.status} role="status" aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      <p>{message}</p>
      <button type="button" onClick={renew}>Renew with stablecoin</button>
    </aside>
  );
}
