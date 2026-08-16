"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./admin-street-team-section.module.css";

type StreetTeamInterestPlan = "free" | "bond" | "bond_site" | "bond_pro_site" | "pro" | "pro_bundle";

type StreetTeamInterestRecord = {
  id: string;
  walletAddress: string | null;
  currentPlan: StreetTeamInterestPlan;
  createdAt: string;
};

type StreetTeamInterestSnapshot = {
  status: "ready" | "unavailable";
  message: string;
  count: number;
  recent: StreetTeamInterestRecord[];
};

const PLAN_LABEL: Record<StreetTeamInterestPlan, string> = {
  free: "Free",
  bond: "Bond",
  bond_site: "Bond + Site",
  bond_pro_site: "Bond + Pro Site",
  pro: "Pro",
  pro_bundle: "Pro Bundle",
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function truncateWallet(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function AdminStreetTeamSection() {
  const [snapshot, setSnapshot] = useState<StreetTeamInterestSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadInterest = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/street-team", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "Street Team interest data could not be loaded."));
      }
      const payload = (await response.json()) as StreetTeamInterestSnapshot;
      setSnapshot(payload);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Street Team interest data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadInterest());
  }, [loadInterest]);

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Street Team</h2>
          <p className={styles.sectionIntro}>
            Interest signups for the coming-soon Street Team add-on ($25/month). No payment is taken and no
            entitlement is granted here — this is a demand signal only.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadInterest()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {snapshot?.status === "unavailable" ? <p className={styles.notice} role="status">{snapshot.message}</p> : null}

      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <p className={styles.summaryValue}>{snapshot?.count ?? 0}</p>
          <p className={styles.summaryLabel}>total interest signups</p>
        </div>
      </div>

      {!loading && snapshot?.status === "ready" && snapshot.recent.length === 0 ? (
        <p className={styles.empty}>No Street Team interest yet.</p>
      ) : null}

      <ul className={styles.rowList}>
        {(snapshot?.recent || []).map((entry) => (
          <li key={entry.id} className={styles.row}>
            {entry.walletAddress ? (
              <span className={styles.wallet}>{truncateWallet(entry.walletAddress)}</span>
            ) : (
              <span className={styles.anonymous}>Anonymous</span>
            )}
            <span className={styles.meta}>
              <span className={styles.planBadge}>{PLAN_LABEL[entry.currentPlan]}</span>
              <span className={styles.timestamp}>{formatDate(entry.createdAt)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
