"use client";

import { useEffect, useRef, useState } from "react";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
};

type AnnouncedProvider = {
  info: { name?: string; rdns?: string };
  provider: Eip1193Provider;
};

type BrowserWindow = Window & {
  ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  phantom?: { ethereum?: Eip1193Provider };
  __launchpadEthereum?: Eip1193Provider;
};

type PendingWallet = {
  walletName: string;
  account: string;
  provider: Eip1193Provider;
};

const WALLET_NAMES = ["MetaMask", "Rabby", "Phantom"] as const;

const WALLET_MATCHERS: Record<string, string[]> = {
  MetaMask: ["metamask", "io.metamask"],
  Rabby: ["rabby", "io.rabby"],
  Phantom: ["phantom", "app.phantom"],
};

function shortAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function injectedFallback(walletName: string, browserWindow: BrowserWindow) {
  const providers = browserWindow.ethereum?.providers || (browserWindow.ethereum ? [browserWindow.ethereum] : []);

  if (walletName === "MetaMask") return providers.find((provider) => provider.isMetaMask && !provider.isRabby);
  if (walletName === "Rabby") return providers.find((provider) => provider.isRabby);
  if (walletName === "Phantom") {
    return browserWindow.phantom?.ethereum || providers.find((provider) => provider.isPhantom);
  }

  return undefined;
}

async function discoverProvider(walletName: string) {
  const announced: AnnouncedProvider[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AnnouncedProvider>).detail;
    if (detail?.provider) announced.push(detail);
  };

  window.addEventListener("eip6963:announceProvider", listener as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  window.removeEventListener("eip6963:announceProvider", listener as EventListener);

  const matchers = WALLET_MATCHERS[walletName].map((value) => value.toLowerCase());
  const exact = announced.find(({ info }) => {
    const identity = `${info.name || ""} ${info.rdns || ""}`.toLowerCase();
    return matchers.some((matcher) => identity.includes(matcher));
  });

  return exact?.provider || injectedFallback(walletName, window as BrowserWindow);
}

export function AccountWalletBridge() {
  const [status, setStatus] = useState("Choose a wallet below. You will confirm the wallet and address before it is used.");
  const [confirmedWallet, setConfirmedWallet] = useState("");
  const [pendingWallet, setPendingWallet] = useState<PendingWallet | null>(null);
  const pendingRef = useRef<PendingWallet | null>(null);

  function resetWalletCards() {
    document.querySelectorAll<HTMLButtonElement>("button[data-wallet-option]").forEach((button) => {
      button.removeAttribute("aria-current");
      const badge = button.querySelector("em");
      if (badge) badge.textContent = "Connect";
    });
  }

  function changeWallet() {
    pendingRef.current = null;
    setPendingWallet(null);
    setConfirmedWallet("");
    const browserWindow = window as BrowserWindow;
    delete browserWindow.__launchpadEthereum;
    localStorage.removeItem("hoodlums.account.wallet");
    resetWalletCards();
    setStatus("Choose a wallet type or a different wallet address.");
  }

  function confirmWallet() {
    const selected = pendingRef.current;
    if (!selected) return;

    const browserWindow = window as BrowserWindow;
    browserWindow.__launchpadEthereum = selected.provider;
    localStorage.setItem(
      "hoodlums.account.wallet",
      JSON.stringify({ walletName: selected.walletName, account: selected.account }),
    );
    setConfirmedWallet(`${selected.walletName} · ${shortAddress(selected.account)}`);
    setStatus("Confirmed. This exact wallet and address will be used for launch actions.");
    setPendingWallet(null);
    pendingRef.current = null;
  }

  useEffect(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
    const walletButtons = buttons.filter((button) => WALLET_NAMES.some((name) => button.textContent?.includes(name)));
    const cleanups: Array<() => void> = [];

    walletButtons.forEach((button) => {
      const walletName = WALLET_NAMES.find((name) => button.textContent?.includes(name));
      if (!walletName) return;

      button.disabled = false;
      button.dataset.walletOption = walletName.toLowerCase();
      const originalBadge = button.querySelector("em");
      if (originalBadge) originalBadge.textContent = "Connect";

      const connect = async () => {
        if (button.dataset.connecting === "true") return;
        button.dataset.connecting = "true";
        setStatus(`Looking for ${walletName}…`);

        try {
          const provider = await discoverProvider(walletName);
          if (!provider) {
            setStatus(`${walletName} was not found in this browser.`);
            return;
          }

          const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
          const account = accounts?.[0];
          if (!account) {
            setStatus(`${walletName} did not return an account.`);
            return;
          }

          const selection = { walletName, account, provider };
          pendingRef.current = selection;
          setPendingWallet(selection);
          setConfirmedWallet("");
          setStatus(`Check that ${shortAddress(account)} is the address you want, then confirm it.`);

          walletButtons.forEach((candidate) => candidate.removeAttribute("aria-current"));
          button.setAttribute("aria-current", "true");
          const badge = button.querySelector("em");
          if (badge) badge.textContent = shortAddress(account);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Wallet connection was cancelled.";
          setStatus(message);
        } finally {
          delete button.dataset.connecting;
        }
      };

      button.addEventListener("click", connect);
      cleanups.push(() => button.removeEventListener("click", connect));
    });

    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  return (
    <>
      <aside className="account-wallet-status" aria-live="polite">
        <b>{pendingWallet ? `${pendingWallet.walletName} · ${shortAddress(pendingWallet.account)}` : confirmedWallet || "Wallet connection"}</b>
        <span>{status}</span>
        {pendingWallet ? (
          <div className="account-wallet-actions">
            <button type="button" onClick={confirmWallet}>Confirm wallet</button>
            <button type="button" onClick={changeWallet}>Change wallet</button>
          </div>
        ) : confirmedWallet ? (
          <div className="account-wallet-actions">
            <button type="button" onClick={changeWallet}>Change wallet or address</button>
          </div>
        ) : null}
      </aside>
      <style jsx global>{`
        button[data-wallet-option] { cursor: pointer !important; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
        button[data-wallet-option]:hover { border-color: rgba(185,239,77,.48) !important; background: #0c140d !important; }
        button[data-wallet-option]:active { transform: scale(.995); }
        button[data-wallet-option][aria-current="true"] { border-color: #b9ef4d !important; box-shadow: inset 0 0 0 1px rgba(185,239,77,.18); }
        .account-wallet-status { position: fixed; right: 18px; bottom: calc(94px + env(safe-area-inset-bottom)); z-index: 80; display: grid; gap: 7px; width: min(360px, calc(100% - 36px)); padding: 12px 14px; border: 1px solid rgba(185,239,77,.28); border-radius: 12px; background: rgba(5,10,6,.96); box-shadow: 0 18px 50px rgba(0,0,0,.35); color: #eef4ea; backdrop-filter: blur(14px); }
        .account-wallet-status b { color: #b9ef4d; font-size: 11px; }
        .account-wallet-status span { color: #8d9990; font-size: 10px; line-height: 1.45; }
        .account-wallet-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 2px; }
        .account-wallet-actions button { min-height: 30px; padding: 6px 10px; border: 1px solid rgba(185,239,77,.35); border-radius: 8px; background: #b9ef4d; color: #071006; font: 800 10px "IBM Plex Mono", monospace; cursor: pointer; }
        .account-wallet-actions button + button { background: transparent; color: #c8d1c9; }
        @media (min-width: 1100px) { .account-wallet-status { bottom: 24px; } }
      `}</style>
    </>
  );
}
