"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./admin-token-launches-section.module.css";

// Read-only admin list of recorded token launches (Milestone A, issue #409,
// rule 10). Mirrors AdminSupportSection's fetch/loading/error shape, without
// any reply/status actions — this is purely informational, since nothing in
// this table is ever edited from /admin.

type TokenLaunch = {
  id: string;
  chainId: number;
  tokenAddress: string;
  curveAddress: string;
  creatorWalletAddress: string;
  tokenName: string;
  ticker: string;
  decimals: number;
  wholeTokenSupply: string;
  graduationTargetWei: string;
  graduated: boolean;
  graduatedAt: string | null;
  launchedAt: string;
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function AdminTokenLaunchesSection() {
  const [launches, setLaunches] = useState<TokenLaunch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLaunches = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/token-launches", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        setLoadError(await readError(response, "Token launches could not be loaded."));
        return;
      }
      const data = (await response.json()) as { launches: TokenLaunch[] };
      setLaunches(data.launches);
      setLoadError(null);
    } catch {
      setLoadError("Token launches could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadLaunches());
  }, [loadLaunches]);

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Token launches</h2>
          <p className={styles.sectionIntro}>
            Every curve-backed token launch recorded via /testnet (Milestone A, issue #409), reconciled
            against a live on-chain read before being stored here.
          </p>
        </div>
        <button className={styles.refreshButton} onClick={loadLaunches} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError && <p className={styles.error}>{loadError}</p>}

      {!loadError && launches && launches.length === 0 && (
        <p className={styles.empty}>No token launches have been recorded yet.</p>
      )}

      {!loadError && launches && launches.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Token</th>
                <th>Creator</th>
                <th>Curve</th>
                <th>Status</th>
                <th>Launched</th>
              </tr>
            </thead>
            <tbody>
              {launches.map((launch) => (
                <tr key={launch.id}>
                  <td>
                    <strong>{launch.tokenName}</strong> ({launch.ticker})
                    <br />
                    <code className={styles.address}>{truncateAddress(launch.tokenAddress)}</code>
                  </td>
                  <td>
                    <code className={styles.address}>{truncateAddress(launch.creatorWalletAddress)}</code>
                  </td>
                  <td>
                    <code className={styles.address}>{truncateAddress(launch.curveAddress)}</code>
                  </td>
                  <td>
                    <span className={launch.graduated ? styles.badgeGraduated : styles.badgeBonding}>
                      {launch.graduated ? "Graduated" : "Bonding"}
                    </span>
                  </td>
                  <td>{formatTimestamp(launch.launchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
