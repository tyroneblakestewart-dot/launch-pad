"use client";

import { useRouter } from "next/navigation";
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

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<T>;
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: account }),
  });
  const challenge = await readJsonResponse<AdminChallengeResponse>(
    challengeResponse,
    "The admin challenge could not be created.",
  );
  const signature = await walletClient.signMessage({ account, message: challenge.message });

  const loginResponse = await fetch("/api/admin/login", {
    method: "POST",
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "password", password }),
  });
  await readJsonResponse(response, "Incorrect admin password.");
}

/** Private admin sign-in: owner wallet signature (primary) or a fallback password. Never shows dashboard content. */
export function AdminLoginScreen() {
  const router = useRouter();
  const [method, setMethod] = useState<LoginMethod>("wallet");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleWalletSignIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithWallet();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet sign-in failed.");
    } finally {
      setBusy(false);
    }
  }, [router]);

  const handlePasswordSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await signInWithPassword(password);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Incorrect admin password.");
      } finally {
        setBusy(false);
      }
    },
    [password, router],
  );

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>HOODLUMS Admin</h1>
        <p className={styles.subtitle}>
          Private control panel. Sign in with the owner wallet, or with the fallback password.
        </p>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={method === "wallet"}
            className={method === "wallet" ? styles.tabActive : styles.tab}
            onClick={() => setMethod("wallet")}
          >
            Wallet
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === "password"}
            className={method === "password" ? styles.tabActive : styles.tab}
            onClick={() => setMethod("password")}
          >
            Password
          </button>
        </div>

        {method === "wallet" ? (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy}
            onClick={() => void handleWalletSignIn()}
          >
            {busy ? "Signing in…" : "Connect wallet & sign in"}
          </button>
        ) : (
          <form className={styles.form} onSubmit={(event) => void handlePasswordSubmit(event)}>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Admin password"
              className={styles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <button type="submit" className={styles.primaryButton} disabled={busy || !password}>
              {busy ? "Signing in…" : "Sign in"}
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
