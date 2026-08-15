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

type TestAccessKillSwitchState = {
  hardDisabled: boolean;
  adminEnabled: boolean;
  available: boolean;
  reason: string;
  updatedAt: string | null;
  enabled: boolean;
};

type TestAccessResponse = {
  wallets: TestAccessWallet[];
  activeCount: number;
  revokedCount: number;
  killSwitch: TestAccessKillSwitchState;
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
  const [switching, setSwitching] = useState(false);
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
        data?.killSwitch && !data.killSwitch.enabled
          ? `${wallet} was added, but TEST access is currently disabled — it will have no effect until you re-enable the switch below.`
          : `TEST access is active for ${wallet}. No payment or revenue record was created.`,
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

  async function setKillSwitch(enabled: boolean) {
    let reason = "";
    if (!enabled) {
      const input = window.prompt(
        "Why are you disabling TEST access? This note is kept in the Admin Activity log. Existing wallets and add/revoke stay usable; only entitlement grants stop.",
        "Pausing test access for review.",
      );
      if (input === null) return;
      reason = input.trim();
      if (reason.length < 5) {
        setError("Explain why in at least 5 characters.");
        return;
      }
    }

    setSwitching(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/operations", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceKey: "test-access",
          isolated: !enabled,
          reason: reason || "Re-enabled from the Test access section.",
        }),
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(
          await responseError(response, "The test-access switch could not be changed."),
        );
      }
      setMessage(
        enabled
          ? "TEST access is enabled. Allowlisted wallets pass entitlement checks again."
          : "TEST access is disabled. Allowlisted wallets are blocked until you re-enable it. The list below is unchanged and can still be edited.",
      );
      await load();
    } catch (switchError) {
      setError(
        switchError instanceof Error
          ? switchError.message
          : "The test-access switch could not be changed.",
      );
    } finally {
      setSwitching(false);
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

      {data?.killSwitch ? (
        <div
          className={styles.killSwitchBanner}
          data-state={
            data.killSwitch.hardDisabled
              ? "hard-disabled"
              : !data.killSwitch.available
                ? "unknown"
                : data.killSwitch.enabled
                  ? "enabled"
                  : "disabled"
          }
          role="status"
        >
          <div>
            <p className={styles.killSwitchStatus}>
              {data.killSwitch.hardDisabled
                ? "HARD-DISABLED · ENVIRONMENT"
                : !data.killSwitch.available
                  ? "SWITCH STATE UNKNOWN"
                  : data.killSwitch.enabled
                    ? "ENABLED"
                    : "DISABLED"}
            </p>
            <p className={styles.killSwitchDetail}>
              {data.killSwitch.hardDisabled
                ? "TEST_ACCESS_HARD_DISABLED=true is set on the server. No wallet can gain test access regardless of the switch below or any allowlist row. Change this in Vercel environment variables, not here."
                : !data.killSwitch.available
                  ? "The admin switch state could not be read, so test access fails closed and is treated as disabled until this is confirmed working again."
                  : data.killSwitch.enabled
                    ? "Allowlisted wallets pass entitlement checks. Turning this off blocks every wallet immediately; add/revoke below keep working."
                    : `Disabled${data.killSwitch.reason ? `: ${data.killSwitch.reason}` : "."} Allowlisted wallets are blocked. Add/revoke below still work but have no effect until this is re-enabled.`}
            </p>
          </div>
          {!data.killSwitch.hardDisabled && data.killSwitch.available ? (
            <button
              type="button"
              className={data.killSwitch.enabled ? styles.disableSwitchButton : styles.enableSwitchButton}
              disabled={switching}
              onClick={() => void setKillSwitch(!data.killSwitch.enabled)}
            >
              {switching
                ? "Updating…"
                : data.killSwitch.enabled
                  ? "Disable test access"
                  : "Enable test access"}
            </button>
          ) : null}
        </div>
      ) : null}

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
