"use client";

import { useCallback, useState, type FormEvent } from "react";
import { createWalletClient, custom } from "viem";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./admin-login-screen.module.css";

type LoginMethod = "wallet" | "password";

type AdminChallengeResponse = {
  challengeId: string;
  nonce: string;
  message: string;
};

async function readJsonResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & Partial<T>;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
}

async function signInWithWallet(): Promise<void> {
  const provider = getInjectedEvmProvider();
  if (!provider) throw new Error("Connect an EVM wallet before signing in.");

  const walletClient = createWalletClient({ transport: custom(provider) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("The wallet returned no account.");

  const challengeResponse = await fetch("/api/admin/challenge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: account }),
  });
  const challenge = await readJsonResponse<AdminChallengeResponse>(
    challengeResponse,
    "The admin challenge could not be created.",
  );
  const signature = await walletClient.signMessage({
    account,
    message: challenge.message,
  });

  const loginResponse = await fetch("/api/admin/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "wallet",
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      signature,
    }),
  });
  await readJsonResponse(loginResponse, "Wallet sign-in failed.");
}

async function signInWithPassword(password: string): Promise<void> {
  const response = await fetch("/api/admin/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "password", password }),
  });
  await readJsonResponse(response, "Incorrect admin password.");
}

function showAuthenticatedDashboard(): void {
  // A full navigation guarantees the new httpOnly cookie is sent to the
  // server component gate instead of relying on a stale client-router tree.
  window.location.replace("/admin");
}

type AdminLoginScreenProps = {
  headerTitle?: string;
  headerSubtitle?: string;
  walletTabLabel?: string;
  passwordTabLabel?: string;
  walletButtonLabel?: string;
  passwordPlaceholder?: string;
  passwordButtonLabel?: string;
};

/** Private admin sign-in: owner wallet signature or a fallback password. */
export function AdminLoginScreen({
  headerTitle = "HOODLUMS Admin",
  headerSubtitle = "Private control panel. Sign in with the owner wallet, or with the fallback password.",
  walletTabLabel = "Wallet",
  passwordTabLabel = "Password",
  walletButtonLabel = "Connect wallet & sign in",
  passwordPlaceholder = "Admin password",
  passwordButtonLabel = "Sign in",
}: AdminLoginScreenProps = {}) {
  const [method, setMethod] = useState<LoginMethod>("wallet");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleWalletSignIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithWallet();
      showAuthenticatedDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet sign-in failed.");
      setBusy(false);
    }
  }, []);

  const handlePasswordSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await signInWithPassword(password);
        showAuthenticatedDashboard();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Incorrect admin password.");
        setBusy(false);
      }
    },
    [password],
  );

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>{headerTitle}</h1>
        <p className={styles.subtitle}>{headerSubtitle}</p>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={method === "wallet"}
            className={method === "wallet" ? styles.tabActive : styles.tab}
            onClick={() => setMethod("wallet")}
          >
            {walletTabLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === "password"}
            className={method === "password" ? styles.tabActive : styles.tab}
            onClick={() => setMethod("password")}
          >
            {passwordTabLabel}
          </button>
        </div>

        {method === "wallet" ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy}
            onClick={() => void handleWalletSignIn()}
          >
            {busy ? "Signing in…" : walletButtonLabel}
          </button>
        ) : (
          <form
            className={styles.form}
            onSubmit={(event) => void handlePasswordSubmit(event)}
          >
            <input
              type="password"
              autoComplete="current-password"
              placeholder={passwordPlaceholder}
              className={styles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={busy || !password}
            >
              {busy ? "Signing in…" : passwordButtonLabel}
            </button>
          </form>
        )}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
