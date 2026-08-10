"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ACCOUNT_WALLET_CHANGE_EVENT,
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
} from "@/lib/account-wallet-state";
import { storeLaunchPathPreset } from "@/lib/launch-paths";
import {
  subscriptionGateStateFromServer,
  type SubscriptionGateState,
} from "@/lib/subscription-access-gate";
import type { SubscriptionAccess } from "@/lib/subscription-lifecycle";
import styles from "./subscription-access-gate.module.css";

type GateView = {
  state: SubscriptionGateState;
  walletAddress: string | null;
  access: SubscriptionAccess | null;
};

const INITIAL_VIEW: GateView = {
  state: "checking",
  walletAddress: null,
  access: null,
};

function storedWalletAddress(): string | null {
  try {
    return parseStoredAccountWallet(
      localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY),
    )?.account ?? null;
  } catch {
    return null;
  }
}

export function SubscriptionAccessGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<GateView>(INITIAL_VIEW);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let controller: AbortController | null = null;
    let requestVersion = 0;

    async function refreshAccess() {
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

        setView({
          state: subscriptionGateStateFromServer(access),
          walletAddress,
          access,
        });
      } catch {
        if (version !== requestVersion || controller?.signal.aborted) return;
        setView({ state: "unavailable", walletAddress, access: null });
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === ACCOUNT_WALLET_STORAGE_KEY) {
        void refreshAccess();
      }
    }

    void refreshAccess();
    window.addEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refreshAccess);
    window.addEventListener("storage", onStorage);
    return () => {
      requestVersion += 1;
      controller?.abort();
      window.removeEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refreshAccess);
      window.removeEventListener("storage", onStorage);
    };
  }, [retryKey]);

  if (view.state === "unlocked") return children;

  function openAccount() {
    const url = new URL(window.location.href);
    url.searchParams.set("account", "open");
    window.location.assign(`${url.pathname}${url.search}${url.hash}`);
  }

  function openSubscriptionCheckout() {
    storeLaunchPathPreset(view.access?.plan ?? "pro");
    window.location.assign("/");
  }

  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-live="polite">
        <span className={styles.eyebrow}>PRO · AI SOCIAL STUDIO</span>

        {view.state === "checking" ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            <h1>Checking subscription…</h1>
            <p>
              Confirming this wallet with the Hoodlums server before loading
              the studio.
            </p>
          </>
        ) : null}

        {view.state === "disconnected" ? (
          <>
            <h1>Connect your Hoodlums wallet.</h1>
            <p>
              Connect the wallet used for your subscription. The server will
              check access automatically after it reconnects.
            </p>
            <button type="button" onClick={openAccount}>Connect wallet</button>
          </>
        ) : null}

        {view.state === "unavailable" ? (
          <>
            <h1>Subscription check unavailable.</h1>
            <p>
              The paywall has not been shown because the server did not return
              a subscription decision. Retry the check without paying again.
            </p>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
              Retry server check
            </button>
          </>
        ) : null}

        {view.state === "paywall" ? (
          <>
            <h1>
              {view.access?.plan ? "Your subscription needs renewing." : "Unlock AI Social Studio."}
            </h1>
            <p>
              {view.access?.plan
                ? "The server says this subscription has expired. Your saved data remains safe."
                : "The server could not find an active Pro or Pro Bundle subscription for this wallet."}
            </p>
            <button type="button" onClick={openSubscriptionCheckout}>
              {view.access?.plan ? "Renew subscription" : "View Pro plans"}
            </button>
          </>
        ) : null}
      </section>
    </main>
  );
}
