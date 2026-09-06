"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./admin-token-launches-section.module.css";

// Read-only admin list of Google sign-in accounts (phase 1, 6 Sep 2026, rule
// 10). Mirrors AdminTokenLaunchesSection: informational only — nothing here
// is edited from /admin; users unlink or delete from the account panel.

type GoogleAccountRow = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  linkedWalletAddress: string | null;
  walletLinkedAt: string | null;
  lastSignInAt: string;
  createdAt: string;
};

type Counts = { accounts: number; linked: number; signedIn7d: number };

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function AdminGoogleAccountsSection() {
  const [accounts, setAccounts] = useState<GoogleAccountRow[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/google-accounts", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        setLoadError(await readError(response, "Sign-in accounts could not be loaded."));
        return;
      }
      const data = (await response.json()) as { accounts: GoogleAccountRow[]; counts: Counts };
      setAccounts(data.accounts);
      setCounts(data.counts);
      setLoadError(null);
    } catch {
      setLoadError("Sign-in accounts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <section className={styles.panel} aria-labelledby="admin-google-accounts-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="admin-google-accounts-title" className={styles.sectionTitle}>Sign-ins</h2>
          <p className={styles.sectionIntro}>
            Google accounts that have signed in, and the wallet each is linked to. A Google account is a linked credential only — plan, projects and bots stay with the wallet.
            {counts ? ` ${counts.accounts} account(s), ${counts.linked} linked, ${counts.signedIn7d} signed in this week.` : ""}
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {loadError ? <p className={styles.error}>{loadError}</p> : null}
      {accounts && accounts.length === 0 ? <p className={styles.empty}>No Google sign-ins yet.</p> : null}
      {accounts && accounts.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Linked wallet</th>
                <th>Linked</th>
                <th>Last sign-in</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    {account.email}
                    {account.emailVerified ? "" : " (unverified)"}
                  </td>
                  <td>{account.displayName || "—"}</td>
                  <td>{account.linkedWalletAddress ? <code title={account.linkedWalletAddress}>{truncateAddress(account.linkedWalletAddress)}</code> : "—"}</td>
                  <td>{formatTimestamp(account.walletLinkedAt)}</td>
                  <td>{formatTimestamp(account.lastSignInAt)}</td>
                  <td>{formatTimestamp(account.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
