"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { getAddress } from "viem";
import styles from "./admin-test-access-section.module.css";

type TestAccessWallet = {
  id: string;
  walletAddress: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  active: boolean;
};

type TestAccessResponse = {
  wallets: TestAccessWallet[];
  activeCount: number;
  revokedCount: number;
};

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : fallback;
}

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function normalisedWallet(value: string): string | null {
  try {
    return getAddress(value.trim()).toLowerCase();
  } catch {
    return null;
  }
}

export function AdminTestAccessSection() {
  const [data, setData] = useState<TestAccessResponse | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/test-access", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Test-access wallets could not be loaded."),
        );
      }
      setData((await response.json()) as TestAccessResponse);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Test-access wallets could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const activeWallets = useMemo(
    () => (data?.wallets || []).filter((wallet) => wallet.active),
    [data],
  );
  const revokedWallets = useMemo(
    () => (data?.wallets || []).filter((wallet) => !wallet.active),
    [data],
  );

  async function addWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const wallet = normalisedWallet(walletAddress);
    if (!wallet) {
      setError("Enter a valid EVM wallet address.");
      return;
    }
    const cleanLabel = label.trim().replace(/\s+/g, " ");
    if (!cleanLabel || cleanLabel.length > 120) {
      setError("Enter a short label between 1 and 120 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/test-access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, label: cleanLabel }),
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Test access could not be added."),
        );
      }
      setWalletAddress("");
      setLabel("");
      setMessage(
        `TEST access is active for ${wallet}. No payment or revenue record was created.`,
      );
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Test access could not be added.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeWallet(wallet: TestAccessWallet) {
    const confirmed = window.confirm(
      `Revoke TEST access for ${wallet.walletAddress}? The row will remain visible as an audit record.`,
    );
    if (!confirmed) return;

    setRevokingId(wallet.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/test-access", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: wallet.id }),
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Test access could not be revoked."),
        );
      }
      setMessage(
        `TEST access was revoked for ${wallet.walletAddress}. Its audit row was retained.`,
      );
      await load();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Test access could not be revoked.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  function walletRow(wallet: TestAccessWallet) {
    return (
      <li key={wallet.id} className={styles.walletRow} data-active={wallet.active}>
        <div className={styles.walletTop}>
          <div className={styles.badges}>
            <span className={styles.testBadge}>TEST</span>
            <span className={wallet.active ? styles.activeBadge : styles.revokedBadge}>
              {wallet.active ? "Active" : "Revoked"}
            </span>
          </div>
          {wallet.active ? (
            <button
              type="button"
              className={styles.revokeButton}
              disabled={revokingId === wallet.id}
              onClick={() => void revokeWallet(wallet)}
            >
              {revokingId === wallet.id ? "Revoking…" : "Revoke access"}
            </button>
          ) : null}
        </div>
        <p className={styles.walletAddress}>{wallet.walletAddress}</p>
        <p className={styles.walletLabel}>{wallet.label}</p>
        <dl className={styles.dates}>
          <div>
            <dt>Added</dt>
            <dd>{dateLabel(wallet.createdAt)}</dd>
          </div>
          <div>
            <dt>Revoked</dt>
            <dd>{dateLabel(wallet.revokedAt)}</dd>
          </div>
        </dl>
      </li>
    );
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ADMIN · TESTING ONLY</p>
          <h2>Wallet test access</h2>
          <p>
            Allowlisted wallets pass paid-feature entitlement checks without
            paying. This is test access only: no payment or revenue recorded.
            Revoked rows stay here as an audit trail.
          </p>
        </div>
        <button
          type="button"
          className={styles.refreshButton}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}

      <form className={styles.form} onSubmit={(event) => void addWallet(event)}>
        <label>
          <span>Wallet address</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={walletAddress}
            disabled={submitting}
            onChange={(event) => setWalletAddress(event.target.value)}
          />
        </label>
        <label>
          <span>Test label</span>
          <input
            type="text"
            maxLength={120}
            placeholder="Tyrone iPhone test wallet"
            value={label}
            disabled={submitting}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className={styles.addButton}
          disabled={submitting || !walletAddress.trim() || !label.trim()}
        >
          {submitting ? "Adding…" : "Add TEST wallet"}
        </button>
      </form>

      <div className={styles.columns}>
        <section className={styles.listSection}>
          <h3>Active TEST wallets <span>{data?.activeCount ?? 0}</span></h3>
          {activeWallets.length === 0 && !loading ? (
            <p className={styles.empty}>No wallet currently has test access.</p>
          ) : null}
          <ul className={styles.walletList}>{activeWallets.map(walletRow)}</ul>
        </section>

        <section className={styles.listSection}>
          <h3>Revoked audit rows <span>{data?.revokedCount ?? 0}</span></h3>
          {revokedWallets.length === 0 && !loading ? (
            <p className={styles.empty}>No test-access wallet has been revoked.</p>
          ) : null}
          <ul className={styles.walletList}>{revokedWallets.map(walletRow)}</ul>
        </section>
      </div>
    </section>
  );
}
