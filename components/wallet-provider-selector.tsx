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
      // Some extensions protect window.ethereum. The selector will explain
      // that a refresh or disabling legacy injection may still be required.
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
    "Choose the EVM wallet used for Robinhood Chain connections.",
  );
  const autoOpened = useRef(false);

  useEffect(() => {
    const storedRdns = localStorage.getItem(PREFERENCE_KEY) || "";
    const storedName = localStorage.getItem(PREFERENCE_NAME_KEY) || "";
    setSelectedRdns(storedRdns);
    setSelectedName(storedName);

    function announce(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isProviderDetail(detail)) return;

      setProviders((current) => {
        if (current.some((item) => item.info.uuid === detail.info.uuid)) {
          return current;
        }
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
    if (
      providers.length > 1 &&
      !selectedRdns &&
      !autoOpened.current
    ) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [providers.length, selectedRdns]);

  useEffect(() => {
    function reapplyOnFocus() {
      if (selectedProvider) installSelectedProvider(selectedProvider.provider);
    }
    window.addEventListener("focus", reapplyOnFocus);
    return () => window.removeEventListener("focus", reapplyOnFocus);
  }, [selectedProvider]);

  function chooseWallet(detail: Eip6963ProviderDetail) {
    localStorage.setItem(PREFERENCE_KEY, detail.info.rdns);
    localStorage.setItem(PREFERENCE_NAME_KEY, detail.info.name);
    setSelectedRdns(detail.info.rdns);
    setSelectedName(detail.info.name);
    installSelectedProvider(detail.provider);
    setMessage(`${detail.info.name} selected. Now press the page's Connect wallet button.`);
    setOpen(false);
  }

  function clearSelection() {
    localStorage.removeItem(PREFERENCE_KEY);
    localStorage.removeItem(PREFERENCE_NAME_KEY);
    setSelectedRdns("");
    setSelectedName("");
    setMessage("Wallet preference cleared. Choose a wallet before connecting again.");
    setOpen(true);
  }

  function refreshWallets() {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setMessage("Wallet discovery requested again.");
  }

  return (
    <>
      <button
        className={selectedRdns ? styles.triggerSelected : styles.trigger}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span>{selectedRdns ? "EVM wallet" : "Choose wallet"}</span>
        <b>{selectedName || `${providers.length || "No"} detected`}</b>
      </button>

      {open && (
        <div className={styles.backdrop} role="dialog" aria-modal="true">
          <section className={styles.modal}>
            <header>
              <div>
                <p>ROBINHOOD / EVM</p>
                <h2>Choose which wallet connects</h2>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close wallet selector">
                ×
              </button>
            </header>

            <div className={styles.message}>{message}</div>

            <div className={styles.walletList}>
              {providers.length === 0 ? (
                <div className={styles.empty}>
                  No EVM wallet has announced itself yet. Unlock your extension, then refresh detection.
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
                        // EIP-6963 requires wallet icons to be rendered through img.
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
                      <em>{active ? "SELECTED" : "USE"}</em>
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
              <b>Solana:</b> Phantom remains the wallet used on Solana pages. Always verify the wallet popup, account and chain before approving.
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
