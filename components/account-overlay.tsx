"use client";

import { useEffect, useState } from "react";
import {
  ACCOUNT_WALLET_CHANGE_EVENT,
  ACCOUNT_WALLET_STORAGE_KEY,
  parseStoredAccountWallet,
  truncateAccountAddress,
  type StoredAccountWallet,
} from "@/lib/account-wallet-state";
import { AccountWalletBridge } from "./account-wallet-bridge";
import styles from "./account-overlay.module.css";

export type AccountOverlayContent = {
  header_eyebrow: string;
  header_title: string;
  header_intro: string;
  web_accounts_title: string;
  web_accounts_subtitle: string;
  google_note: string;
  github_note: string;
  x_note: string;
  wallet_title: string;
  wallet_subtitle: string;
  metamask_note: string;
  rabby_note: string;
  phantom_note: string;
  footer_copy: string;
};

type ProviderName = "Google" | "GitHub" | "X" | "MetaMask" | "Rabby" | "Phantom";

type AccountContentResponse = {
  content?: AccountOverlayContent;
};

function ProviderMark({ name }: { name: ProviderName }) {
  const labels: Record<ProviderName, string> = {
    Google: "G",
    GitHub: "GH",
    X: "X",
    MetaMask: "M",
    Rabby: "R",
    Phantom: "P",
  };

  return (
    <span className={`${styles.mark} ${styles[name.toLowerCase()]}`} aria-hidden="true">
      {labels[name]}
    </span>
  );
}

function readStoredWallet(): StoredAccountWallet | null {
  return parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY));
}

export function AccountOverlay({ initialContent }: { initialContent: AccountOverlayContent }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [wallet, setWallet] = useState<StoredAccountWallet | null>(null);

  useEffect(() => {
    function refreshWallet() {
      setWallet(readStoredWallet());
    }

    refreshWallet();
    window.addEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refreshWallet);
    window.addEventListener("storage", refreshWallet);
    return () => {
      window.removeEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refreshWallet);
      window.removeEventListener("storage", refreshWallet);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("account") === "open") setOpen(true);

    if (params.get("cms_preview") !== "1") return;
    const controller = new AbortController();

    fetch("/api/account-content?cms_preview=1", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: AccountContentResponse | null) => {
        if (payload?.content) setContent(payload.content);
      })
      .catch(() => {
        // Published content already supplied by the server remains the fallback.
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeOverlay();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function closeOverlay() {
    setOpen(false);

    const url = new URL(window.location.href);
    if (!url.searchParams.has("account")) return;
    url.searchParams.delete("account");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  const webAccounts: { name: ProviderName; note: string }[] = [
    { name: "Google", note: content.google_note },
    { name: "GitHub", note: content.github_note },
    { name: "X", note: content.x_note },
  ];

  const wallets: { name: ProviderName; note: string }[] = [
    { name: "MetaMask", note: content.metamask_note },
    { name: "Rabby", note: content.rabby_note },
    { name: "Phantom", note: content.phantom_note },
  ];

  return (
    <>
      <button
        type="button"
        className={`${styles.launcher} ${wallet ? styles.launcherConnected : ""}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={wallet ? `Account connected as ${wallet.account}` : "Open account"}
      >
        {wallet ? (
          <>
            <span className={styles.connectedDot} aria-hidden="true" />
            <span>{truncateAccountAddress(wallet.account)}</span>
          </>
        ) : (
          "Account"
        )}
      </button>

      {open && (
        <div
          className={styles.backdrop}
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeOverlay();
          }}
        >
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-overlay-title"
          >
            <header className={styles.header}>
              <div className={styles.headerCopy}>
                <p className={styles.eyebrow}>{content.header_eyebrow}</p>
                <h2 id="account-overlay-title">{content.header_title}</h2>
                <p className={styles.intro}>{content.header_intro}</p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={closeOverlay}
                aria-label="Close account"
              >
                ×
              </button>
            </header>

            <section className={styles.group} aria-labelledby="account-web-title">
              <div className={styles.groupHeading}>
                <h3 id="account-web-title">{content.web_accounts_title}</h3>
                <small>{content.web_accounts_subtitle}</small>
              </div>
              <div className={styles.options}>
                {webAccounts.map((account) => (
                  <button key={account.name} className={styles.option} type="button" disabled>
                    <ProviderMark name={account.name} />
                    <span className={styles.optionCopy}>
                      <b>{account.name}</b>
                      <small>{account.note}</small>
                    </span>
                    <em>Coming next</em>
                  </button>
                ))}
              </div>
            </section>

            <div className={styles.divider}>OR USE A WALLET</div>

            <section className={styles.group} aria-labelledby="account-wallet-title">
              <div className={styles.groupHeading}>
                <h3 id="account-wallet-title">{content.wallet_title}</h3>
                <small>{content.wallet_subtitle}</small>
              </div>
              <div className={styles.options}>
                {wallets.map((walletOption) => (
                  <button key={walletOption.name} className={styles.option} type="button" disabled>
                    <ProviderMark name={walletOption.name} />
                    <span className={styles.optionCopy}>
                      <b>{walletOption.name}</b>
                      <small>{walletOption.note}</small>
                    </span>
                    <em>Connect</em>
                  </button>
                ))}
              </div>
            </section>

            <AccountWalletBridge embedded />
            <footer className={styles.footer}>{content.footer_copy}</footer>
          </section>
        </div>
      )}
    </>
  );
}
