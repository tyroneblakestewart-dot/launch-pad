"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./admin-social-project-slots-section.module.css";

type SocialProjectSlot = {
  projectId: string;
  displayName: string;
  registeredAt: string;
};

type SubscriberRow = {
  walletAddress: string;
  tier: string;
  socialProjectSlots: SocialProjectSlot[];
};

type SubscribersResponse = {
  status: "ready" | "unavailable";
  message: string;
  rows: SubscriberRow[];
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function truncateWallet(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/**
 * Bypasses the seven-day user release cooldown (issue #407, rule 10) — a
 * separate section from the read-only Subscribers view (which never issues
 * a write request) so that view's "no POST/PATCH" invariant stays intact.
 * Data is read from the same GET /api/admin/subscribers snapshot already
 * showing each wallet's slots; only the release action lives here.
 */
export function AdminSocialProjectSlotsSection() {
  const [rows, setRows] = useState<SubscriberRow[]>([]);
  const [dataStatus, setDataStatus] = useState<"ready" | "unavailable" | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingReleaseKey, setPendingReleaseKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/subscribers", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "Project slot data could not be loaded."));
      }
      const payload = (await response.json()) as SubscribersResponse;
      setRows(payload.rows || []);
      setDataStatus(payload.status);
      setMessage(payload.message || "");
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Project slot data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const walletsWithSlots = useMemo(
    () => rows.filter((row) => row.socialProjectSlots.length > 0),
    [rows],
  );

  function slotKey(walletAddress: string, projectId: string): string {
    return `${walletAddress}:${projectId}`;
  }

  async function releaseSlot(walletAddress: string, slot: SocialProjectSlot) {
    const key = slotKey(walletAddress, slot.projectId);
    setBusyKey(key);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/social-project-slots/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", walletAddress, projectId: slot.projectId, displayName: slot.displayName }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The slot could not be released."));
      }
      setPendingReleaseKey(null);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The slot could not be released.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Project Slots</h2>
          <p className={styles.sectionIntro}>
            Every wallet with an active AI Social Studio project slot. Releasing here frees the slot immediately and
            bypasses the wallet&apos;s own seven-day release cooldown — use it when a user is locked out and can&apos;t
            wait.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
      {dataStatus === "unavailable" ? <p className={styles.notice} role="status">{message}</p> : null}

      {!loading && walletsWithSlots.length === 0 ? <p className={styles.empty}>No wallets currently hold an active project slot.</p> : null}

      <ul className={styles.rowList}>
        {walletsWithSlots.map((row) => (
          <li key={row.walletAddress} className={styles.row}>
            <p className={styles.wallet}>{truncateWallet(row.walletAddress)}</p>
            <ul className={styles.slotList}>
              {row.socialProjectSlots.map((slot) => {
                const key = slotKey(row.walletAddress, slot.projectId);
                const busy = busyKey === key;
                const pending = pendingReleaseKey === key;
                return (
                  <li key={slot.projectId} className={styles.slotRow}>
                    <div>
                      <b>{slot.displayName}</b>
                      <small>Registered {formatDate(slot.registeredAt)}</small>
                      <code>{slot.projectId}</code>
                    </div>
                    {pending ? (
                      <div className={styles.confirmRow}>
                        <span>Release this slot now, bypassing the cooldown?</span>
                        <button
                          type="button"
                          className={styles.confirmButton}
                          disabled={busy}
                          onClick={() => void releaseSlot(row.walletAddress, slot)}
                        >
                          {busy ? "Releasing…" : "Confirm release"}
                        </button>
                        <button type="button" className={styles.cancelButton} disabled={busy} onClick={() => setPendingReleaseKey(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={styles.releaseButton} onClick={() => setPendingReleaseKey(key)}>
                        Release
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
