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
  __launchpadEthereumInfo?: Eip6963ProviderInfo;
};

const PREFERENCE_KEY = "launchpad-preferred-evm-wallet";
const PREFERENCE_NAME_KEY = "launchpad-preferred-evm-wallet-name";
const BYPASS_ATTRIBUTE = "data-wallet-selector-bypass";
let exactRouterInstalled = false;

function clearInstalledProvider() {
  const browserWindow = window as BrowserWindow;
  browserWindow.__launchpadEthereum = undefined;
  browserWindow.__launchpadEthereumInfo = undefined;
}

function installSelectedProvider(detail: Eip6963ProviderDetail) {
  const browserWindow = window as BrowserWindow;
  browserWindow.__launchpadEthereum = detail.provider;
  browserWindow.__launchpadEthereumInfo = detail.info;

  if (!exactRouterInstalled) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(browserWindow, "ethereum");
      if (!descriptor || descriptor.configurable) {
        Object.defineProperty(browserWindow, "ethereum", {
          configurable: false,
          enumerable: true,
          get() {
            return browserWindow.__launchpadEthereum;
          },
          set(value: Eip1193Provider | undefined) {
            // Ignore extension attempts to replace the confirmed provider. Before a
            // wallet is selected, retain a valid injected provider only as discovery
            // data; connection requests still require an EIP-6963 confirmation.
            if (!browserWindow.__launchpadEthereum && value?.request) {
              browserWindow.__launchpadEthereum = value;
            }
          },
        });
        exactRouterInstalled = true;
        return;
      }
    } catch {
      // Fall through to patching the protected injected provider below.
    }
  }

  if (exactRouterInstalled) return;

  // Some extensions expose a non-configurable window.ethereum property. In that
  // case route its request method through the exact EIP-6963 provider selected by
  // the user. This is reapplied immediately before the React click handler runs.
  const injected = browserWindow.ethereum;
  if (!injected || injected === detail.provider) return;

  const routedRequest = detail.provider.request.bind(detail.provider);
  try {
    Object.defineProperty(injected, "request", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: routedRequest,
    });
  } catch {
    try {
      injected.request = routedRequest;
    } catch {
      // __launchpadEthereum remains the source of truth for launchpad code.
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
  const [pendingWallet, setPendingWallet] = useState<Eip6963ProviderDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [message, setMessage] = useState(
    "Choose the wallet you want to use for this connection.",
  );
  const pendingConnectButton = useRef<HTMLButtonElement | null>(null);
  const confirmedWallet = useRef<Eip6963ProviderDetail | null>(null);

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
        confirmedWallet.current = detail;
        installSelectedProvider(detail);
      }
    }

    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((item) => item.info.rdns === selectedRdns) || null,
    [providers, selectedRdns],
  );

  useEffect(() => {
    if (!selectedProvider) return;
    confirmedWallet.current = selectedProvider;
    installSelectedProvider(selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    function reapplyOnFocus() {
      if (confirmedWallet.current) installSelectedProvider(confirmedWallet.current);
    }
    window.addEventListener("focus", reapplyOnFocus);
    return () => window.removeEventListener("focus", reapplyOnFocus);
  }, []);

  useEffect(() => {
    function interceptConnect(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button.wallet-button") as HTMLButtonElement | null;
      if (!button || button.disabled) return;

      if (button.hasAttribute(BYPASS_ATTRIBUTE)) {
        // Reapply at the final capture phase, immediately before TokenStudio reads
        // window.ethereum. This prevents another extension winning a timing race.
        if (confirmedWallet.current) installSelectedProvider(confirmedWallet.current);
        button.removeAttribute(BYPASS_ATTRIBUTE);
        return;
      }

      // Solana uses Phantom's dedicated Solana provider, not window.ethereum.
      if (button.textContent?.toLowerCase().includes("phantom")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pendingConnectButton.current = button;
      setPendingWallet(null);
      setMessage("Choose a wallet below. Nothing will open until you confirm.");
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
      if (confirmedWallet.current) installSelectedProvider(confirmedWallet.current);
      button.setAttribute(BYPASS_ATTRIBUTE, "true");
      button.click();
    }, 0);
  }

  function chooseWallet(detail: Eip6963ProviderDetail) {
    setPendingWallet(detail);
    setMessage(`${detail.info.name} selected. Confirm below before its extension opens.`);
  }

  async function confirmWallet() {
    if (!pendingWallet || isConfirming) return;
    setIsConfirming(true);

    try {
      localStorage.setItem(PREFERENCE_KEY, pendingWallet.info.rdns);
      localStorage.setItem(PREFERENCE_NAME_KEY, pendingWallet.info.name);
      setSelectedRdns(pendingWallet.info.rdns);
      setSelectedName(pendingWallet.info.name);
      confirmedWallet.current = pendingWallet;
      installSelectedProvider(pendingWallet);
      setMessage(
        `Confirmed route: ${pendingWallet.info.name} · ${pendingWallet.info.rdns} · ${pendingWallet.info.uuid}`,
      );
      setOpen(false);
      continueConnection();
    } finally {
      setIsConfirming(false);
    }
  }

  function clearSelection() {
    localStorage.removeItem(PREFERENCE_KEY);
    localStorage.removeItem(PREFERENCE_NAME_KEY);
    confirmedWallet.current = null;
    clearInstalledProvider();
    setSelectedRdns("");
    setSelectedName("");
    setPendingWallet(null);
    setMessage("Wallet preference cleared. Choose a wallet below.");
  }

  function refreshWallets() {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setMessage("Wallet detection refreshed.");
  }

  function closeSelector() {
    pendingConnectButton.current = null;
    setPendingWallet(null);
    setOpen(false);
  }

  if (!open) return null;

  const pendingIcon = pendingWallet?.info.icon.startsWith("data:image/")
    ? pendingWallet.info.icon
    : "";

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
              No EIP-6963 wallet has announced itself. Unlock the wallet extension, then refresh detection.
            </div>
          ) : (
            providers.map((detail) => {
              const icon = detail.info.icon.startsWith("data:image/")
                ? detail.info.icon
                : "";
              const active = detail.info.uuid === pendingWallet?.info.uuid;
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
                  <em>{active ? "SELECTED" : "CHOOSE"}</em>
                </button>
              );
            })
          )}
        </div>

        {pendingWallet && (
          <section className={styles.confirmPanel} aria-live="polite">
            <div className={styles.confirmWallet}>
              {pendingIcon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pendingIcon} alt="" />
              ) : (
                <span className={styles.fallbackIcon}>
                  {pendingWallet.info.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span>
                <small>SELECTED WALLET</small>
                <b>{pendingWallet.info.name}</b>
                <code>{pendingWallet.info.rdns}</code>
                <code>{pendingWallet.info.uuid}</code>
              </span>
            </div>
            <button onClick={confirmWallet} disabled={isConfirming} type="button">
              {isConfirming ? "CONNECTING…" : `CONNECT ${pendingWallet.info.name.toUpperCase()}`}
            </button>
          </section>
        )}

        <div className={styles.actions}>
          <button onClick={refreshWallets} type="button">Refresh wallets</button>
          {selectedRdns && (
            <button onClick={clearSelection} type="button">Forget selection</button>
          )}
        </div>

        <footer>
          <b>Exact provider routing:</b> only the EIP-6963 provider shown above is permitted to receive the connection request. Selecting a card does nothing until you confirm. The launchpad never asks for or stores a seed phrase.
          {selectedName ? ` Current preference: ${selectedName}.` : ""}
        </footer>
      </section>
    </div>
  );
}
