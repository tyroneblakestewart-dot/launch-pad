"use client";

import { useEffect, useState } from "react";
import { createWalletClient, custom } from "viem";
import { ACCOUNT_WALLET_CHANGE_EVENT, ACCOUNT_WALLET_STORAGE_KEY, parseStoredAccountWallet, truncateAccountAddress } from "@/lib/account-wallet-state";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./account-overlay.module.css";

// Sign in with Google, phase 1 (owner direction, 6 Sep 2026). Lives inside
// the account overlay's "Continue with" group. States: not configured (row
// stays "coming next"), signed out (row is a real button that starts the
// OAuth redirect), signed in (email on file, plus Link this wallet / Unlink /
// Sign out / Delete account). A Google account is a linked credential to the
// wallet, never a second identity — linking is one wallet signature over a
// challenge bound to this session's account, and every paid or on-chain
// action still asks the wallet.

type AccountSummary = {
  email: string;
  emailVerified: boolean;
  displayName: string;
  linkedWalletAddress: string | null;
  walletLinkedAt: string | null;
};

type SessionResponse = { configured: boolean; account: AccountSummary | null };

type Status = { tone: "progress" | "success" | "error"; message: string } | null;

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}

function describeReason(reason: string | null): string {
  switch (reason) {
    case "denied":
      return "Google sign-in was cancelled.";
    case "expired":
      return "That sign-in took too long — try again.";
    case "state":
      return "That sign-in link was not valid — try again.";
    case "unverified_email":
      return "Google reports that email as unverified. Verify it with Google first.";
    case "not_configured":
      return "Google sign-in is not switched on yet.";
    case "paused":
      return "Google sign-in is paused for maintenance.";
    case "storage":
      return "Account storage is not ready on this deployment.";
    default:
      return "Google sign-in did not complete — try again.";
  }
}

export function GoogleAccountPanel({ note, logo, mark }: { note: string; logo: string; mark: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [wallet, setWallet] = useState(() => (typeof window === "undefined" ? null : parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY))));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("google");
    if (outcome === "success") return { tone: "success", message: "Signed in with Google." };
    if (outcome === "error") return { tone: "error", message: describeReason(params.get("reason")) };
    return null;
  });
  const [deleteArmed, setDeleteArmed] = useState(false);

  async function loadSession() {
    try {
      const response = await fetch("/api/account/session", { cache: "no-store", credentials: "same-origin" });
      const payload = await readJson<SessionResponse>(response, "Could not check your sign-in.");
      setConfigured(payload.configured);
      setAccount(payload.account);
    } catch {
      setConfigured((current) => current ?? false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void loadSession());
    const params = new URLSearchParams(window.location.search);
    if (params.has("google")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("google");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    function refreshWallet() {
      setWallet(parseStoredAccountWallet(localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY)));
    }
    window.addEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refreshWallet);
    window.addEventListener("storage", refreshWallet);
    return () => {
      window.removeEventListener(ACCOUNT_WALLET_CHANGE_EVENT, refreshWallet);
      window.removeEventListener("storage", refreshWallet);
    };
  }, []);

  function startSignIn() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/api/account/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function linkWallet() {
    const provider = getInjectedEvmProvider();
    if (!provider || !wallet) {
      setStatus({ tone: "error", message: "Connect and confirm a wallet below first." });
      return;
    }
    setBusy(true);
    setStatus({ tone: "progress", message: "Sign once in your wallet to link it to this Google account…" });
    try {
      const walletClient = createWalletClient({ transport: custom(provider) });
      const [activeAccount] = await walletClient.getAddresses();
      if (!activeAccount) throw new Error("Connect a wallet first.");
      if (activeAccount.toLowerCase() !== wallet.account.toLowerCase()) {
        throw new Error(`Your wallet is on ${truncateAccountAddress(activeAccount)} but the confirmed address is ${truncateAccountAddress(wallet.account)}. Switch accounts or re-confirm below.`);
      }
      const walletChainId = await walletClient.getChainId();
      const challengeResponse = await fetch("/api/account/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ walletAddress: activeAccount, walletChainId, purpose: "account:link-wallet" }),
      });
      const challenge = await readJson<{ challengeId: string; nonce: string; message: string }>(challengeResponse, "Could not start the link.");
      const signature = await walletClient.signMessage({ account: activeAccount, message: challenge.message });
      const linkResponse = await fetch("/api/account/link-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ challengeId: challenge.challengeId, nonce: challenge.nonce, signature }),
      });
      const payload = await readJson<{ account: AccountSummary }>(linkResponse, "The wallet could not be linked.");
      setAccount(payload.account);
      setStatus({ tone: "success", message: `Linked. ${truncateAccountAddress(payload.account.linkedWalletAddress ?? "")} now belongs to ${payload.account.email}.` });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "The wallet could not be linked." });
    } finally {
      setBusy(false);
    }
  }

  async function post(path: string, fallback: string): Promise<Response> {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: "{}" });
    await readJson<unknown>(response, fallback);
    return response;
  }

  async function unlinkWallet() {
    setBusy(true);
    try {
      await post("/api/account/unlink-wallet", "The wallet could not be unlinked.");
      setAccount((current) => (current ? { ...current, linkedWalletAddress: null, walletLinkedAt: null } : current));
      setStatus({ tone: "success", message: "Wallet unlinked. Your plan and projects stay with the wallet." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "The wallet could not be unlinked." });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await post("/api/account/logout", "Could not sign out.");
      setAccount(null);
      setDeleteArmed(false);
      setStatus({ tone: "success", message: "Signed out of Google on this browser." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "Could not sign out." });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      setStatus({ tone: "progress", message: "Tap Delete again to remove your email and Google link. Your wallet, plan and projects are not touched." });
      return;
    }
    setBusy(true);
    try {
      await post("/api/account/delete", "The account could not be deleted.");
      setAccount(null);
      setDeleteArmed(false);
      setStatus({ tone: "success", message: "Google account removed. Nothing about your wallet changed." });
    } catch (error) {
      setStatus({ tone: "error", message: error instanceof Error ? error.message : "The account could not be deleted." });
    } finally {
      setBusy(false);
    }
  }

  const walletMatchesLink = Boolean(account?.linkedWalletAddress && wallet && account.linkedWalletAddress.toLowerCase() === wallet.account.toLowerCase());

  return (
    <div className={styles.googlePanel}>
      {account ? (
        <div className={styles.googleSignedIn}>
          <span className={`${styles.mark} ${styles[mark]}`} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.markLogo} src={logo} alt="" />
          </span>
          <span className={styles.optionCopy}>
            <b>{account.email}</b>
            <small>
              {account.linkedWalletAddress
                ? `Linked to ${truncateAccountAddress(account.linkedWalletAddress)}${walletMatchesLink ? "" : " (not the wallet confirmed below)"}`
                : "Signed in with Google · no wallet linked yet"}
            </small>
          </span>
          <em>Signed in</em>
        </div>
      ) : (
        <button
          type="button"
          className={styles.option}
          onClick={startSignIn}
          disabled={configured !== true}
          title={configured === false ? "Google sign-in is not switched on yet." : undefined}
        >
          <span className={`${styles.mark} ${styles[mark]}`} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.markLogo} src={logo} alt="" />
          </span>
          <span className={styles.optionCopy}>
            <b>Google</b>
            <small>{note}</small>
          </span>
          <em>{configured === null ? "Checking…" : configured ? "Sign in" : "Coming next"}</em>
        </button>
      )}
      {account ? (
        <div className={styles.googleActions}>
          {account.linkedWalletAddress ? (
            <button type="button" onClick={unlinkWallet} disabled={busy}>Unlink wallet</button>
          ) : (
            <button type="button" className={styles.googlePrimary} onClick={linkWallet} disabled={busy || !wallet} title={wallet ? undefined : "Confirm a wallet below first."}>
              {wallet ? `Link ${truncateAccountAddress(wallet.account)}` : "Link this wallet"}
            </button>
          )}
          <button type="button" onClick={signOut} disabled={busy}>Sign out</button>
          <button type="button" className={styles.googleDanger} onClick={deleteAccount} disabled={busy}>
            {deleteArmed ? "Delete — are you sure?" : "Delete account"}
          </button>
        </div>
      ) : null}
      {status ? (
        <p className={status.tone === "error" ? styles.googleStatusError : styles.googleStatus} role="status" aria-live="polite">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
