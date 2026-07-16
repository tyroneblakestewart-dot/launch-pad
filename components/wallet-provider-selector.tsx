"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./wallet-provider-selector.module.css";

type Eip1193Provider = {
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
};

type BrowserWindow = Window & {
  ethereum?: Eip1193Provider;
  __launchpadEthereum?: Eip1193Provider;
};

const PREFERENCE_KEY = "launchpad-preferred-evm-wallet";
const PREFERENCE_NAME_KEY = "launchpad-preferred-evm-wallet-name";
const BYPASS_ATTRIBUTE = "data-wallet-selector-bypass";

function installSelectedProvider(provider: Eip1193Provider) {
  const browserWindow = window as BrowserWindow;
  browserWindow.__launchpadEthereum = provider;

  try {
    Object.defineProperty(browserWindow, "ethereum", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: provider,
    });
  } catch {
    try {
      browserWindow.ethereum = provider;
    } catch {
      // Some extensions protect window.ethereum.
    }
  }
}

function isProviderDetail(value: unknown): value is Eip6963ProviderDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<Eip6963ProviderDetail>;
  return Boolean(
    detail.info &&
      typeof detail.info.uuid === "string" &&
      typeof detail.info.name === "string" &&
      typeof detail.info.rdns === "string" &&
      detail.provider &&
      typeof detail.provider.request === "function",
  );
}

export function WalletProviderSelector() {
  const [providers, setProviders] = useState<Eip6963ProviderDetail[]>([]);
  const [selectedRdns, setSelectedRdns] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(
    "Choose the wallet you want to use for this connection.",
  );
  const pendingConnectButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const storedRdns = localStorage.getItem(PREFERENCE_KEY) || "";
    const storedName = localStorage.getItem(PREFERENCE_NAME_KEY) || "";
    setSelectedRdns(storedRdns);
    setSelectedName(storedName);

    function announce(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isProviderDetail(detail)) return;

      setProviders((current) => {
        if (current.some((item) => item.info.uuid === detail.info.uuid)) return current;
        return [...current, detail].sort((a, b) =>
          a.info.name.localeCompare(b.info.name),
        );
      });

      if (storedRdns && detail.info.rdns === storedRdns) {
        installSelectedProvider(detail.provider);
      }
    }

    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const fallbackTimer = window.setTimeout(() => {
      setProviders((current) => {
        if (current.length > 0) return current;
        const legacy = (window as BrowserWindow).ethereum;
        if (!legacy) return current;
        return [
          {
            info: {
              uuid: "legacy-window-ethereum",
              name: "Browser default wallet",
              icon: "",
              rdns: "legacy.window.ethereum",
            },
            provider: legacy,
          },
        ];
      });
    }, 700);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((item) => item.info.rdns === selectedRdns) || null,
    [providers, selectedRdns],
  );

  useEffect(() => {
    if (selectedProvider) installSelectedProvider(selectedProvider.provider);
  }, [selectedProvider]);

  useEffect(() => {
    function reapplyOnFocus() {
      if (selectedProvider) installSelectedProvider(selectedProvider.provider);
    }
    window.addEventListener("focus", reapplyOnFocus);
    return () => window.removeEventListener("focus", reapplyOnFocus);
  }, [selectedProvider]);

  useEffect(() => {
    function interceptConnect(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button.wallet-button") as HTMLButtonElement | null;
      if (!button || button.disabled) return;

      if (button.hasAttribute(BYPASS_ATTRIBUTE)) {
        button.removeAttribute(BYPASS_ATTRIBUTE);
        return;
      }

      // Solana currently has one supported connection route and can continue directly.
      if (button.textContent?.toLowerCase().includes("phantom")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pendingConnectButton.current = button;
      setMessage("Choose a wallet below. The connection will continue automatically.");
      setOpen(true);
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    }

    document.addEventListener("click", interceptConnect, true);
    return () => document.removeEventListener("click", interceptConnect, true);
  }, []);

  function continueConnection() {
    const button = pendingConnectButton.current;
    pendingConnectButton.current = null;
    if (!button?.isConnected) return;

    window.setTimeout(() => {
      button.setAttribute(BYPASS_ATTRIBUTE, "true");
      button.click();
    }, 0);
  }

  function chooseWallet(detail: Eip6963ProviderDetail) {
    localStorage.setItem(PREFERENCE_KEY, detail.info.rdns);
    localStorage.setItem(PREFERENCE_NAME_KEY, detail.info.name);
    setSelectedRdns(detail.info.rdns);
    setSelectedName(detail.info.name);
    installSelectedProvider(detail.provider);
    setMessage(`${detail.info.name} selected. Opening its connection request…`);
    setOpen(false);
    continueConnection();
  }

  function clearSelection() {
    localStorage.removeItem(PREFERENCE_KEY);
    localStorage.removeItem(PREFERENCE_NAME_KEY);
    setSelectedRdns("");
    setSelectedName("");
    setMessage("Wallet preference cleared. Choose a wallet below.");
  }

  function refreshWallets() {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setMessage("Wallet detection refreshed.");
  }

  function closeSelector() {
    pendingConnectButton.current = null;
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <section className={styles.modal}>
        <header>
          <div>
            <p>CONNECT WALLET</p>
            <h2>Choose which wallet connects</h2>
          </div>
          <button onClick={closeSelector} aria-label="Close wallet selector">
            ×
          </button>
        </header>

        <div className={styles.message}>{message}</div>

        <div className={styles.walletList}>
          {providers.length === 0 ? (
            <div className={styles.empty}>
              No EVM wallet has announced itself yet. Unlock your wallet extension, then refresh detection.
            </div>
          ) : (
            providers.map((detail) => {
              const icon = detail.info.icon.startsWith("data:image/")
                ? detail.info.icon
                : "";
              const active = detail.info.rdns === selectedRdns;
              return (
                <button
                  key={detail.info.uuid}
                  className={active ? styles.walletActive : styles.wallet}
                  onClick={() => chooseWallet(detail)}
                  type="button"
                >
                  {icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={icon} alt="" />
                  ) : (
                    <span className={styles.fallbackIcon}>
                      {detail.info.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span>
                    <b>{detail.info.name}</b>
                    <small>{detail.info.rdns}</small>
                  </span>
                  <em>{active ? "SELECTED" : "CONNECT"}</em>
                </button>
              );
            })
          )}
        </div>

        <div className={styles.actions}>
          <button onClick={refreshWallets} type="button">Refresh wallets</button>
          {selectedRdns && (
            <button onClick={clearSelection} type="button">Forget selection</button>
          )}
        </div>

        <footer>
          <b>Safe connection:</b> the selected wallet opens its own approval window. The launchpad never asks for or stores a seed phrase.
          {selectedName ? ` Current preference: ${selectedName}.` : ""}
        </footer>
      </section>
    </div>
  );
}
