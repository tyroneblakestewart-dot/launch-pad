"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./admin-subscribers-section.module.css";

type SubscriberTier = "free" | "bond" | "bond_site" | "bond_pro_site" | "pro";
type SubscriberStatus = "active" | "expired" | "free";

type SubscriberRow = {
  walletAddress: string;
  tier: SubscriberTier;
  status: SubscriberStatus;
  slugs: string[];
  xHandle: string | null;
  telegram: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  lastPaymentAmountEth: string | null;
  lastPaymentAt: string | null;
};

type SubscribersResponse = {
  status: "ready" | "unavailable";
  message: string;
  rows: SubscriberRow[];
};

const TIER_LABEL: Record<SubscriberTier, string> = {
  free: "Free",
  bond: "Bond",
  bond_site: "Bond+Site",
  bond_pro_site: "Bond+Pro Site",
  pro: "Pro",
};

const STATUS_LABEL: Record<SubscriberStatus, string> = {
  active: "Active",
  expired: "Expired",
  free: "Free tier",
};

const TIER_FILTERS: Array<{ id: SubscriberTier | "all"; label: string }> = [
  { id: "all", label: "All tiers" },
  { id: "free", label: TIER_LABEL.free },
  { id: "bond", label: TIER_LABEL.bond },
  { id: "bond_site", label: TIER_LABEL.bond_site },
  { id: "bond_pro_site", label: TIER_LABEL.bond_pro_site },
  { id: "pro", label: TIER_LABEL.pro },
];

const STATUS_FILTERS: Array<{ id: SubscriberStatus | "all"; label: string }> = [
  { id: "all", label: "All statuses" },
  { id: "active", label: STATUS_LABEL.active },
  { id: "expired", label: STATUS_LABEL.expired },
  { id: "free", label: STATUS_LABEL.free },
];

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function truncateWallet(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Ascending by expiry, soonest first; rows with no expiry (free tier, no set expiry) sort last. */
function compareByExpiry(a: SubscriberRow, b: SubscriberRow): number {
  if (!a.expiresAt && !b.expiresAt) return a.walletAddress.localeCompare(b.walletAddress);
  if (!a.expiresAt) return 1;
  if (!b.expiresAt) return -1;
  return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
}

export function AdminSubscribersSection() {
  const [rows, setRows] = useState<SubscriberRow[]>([]);
  const [dataStatus, setDataStatus] = useState<"ready" | "unavailable" | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<SubscriberTier | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SubscriberStatus | "all">("all");
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  const loadSubscribers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/subscribers", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "Subscriber data could not be loaded."));
      }
      const payload = (await response.json()) as SubscribersResponse;
      setRows(payload.rows || []);
      setDataStatus(payload.status);
      setMessage(payload.message || "");
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Subscriber data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadSubscribers());
  }, [loadSubscribers]);

  const summary = useMemo(() => {
    const activePro = rows.filter((row) => row.tier === "pro" && row.status === "active").length;
    const activeBondProSite = rows.filter((row) => row.tier === "bond_pro_site" && row.status === "active").length;
    const freeTier = rows.filter((row) => row.tier === "free").length;
    return { activePro, activeBondProSite, freeTier };
  }, [rows]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => (tierFilter === "all" ? true : row.tier === tierFilter))
      .filter((row) => (statusFilter === "all" ? true : row.status === statusFilter))
      .filter((row) => {
        if (!query) return true;
        if (row.walletAddress.toLowerCase().includes(query)) return true;
        return row.slugs.some((slug) => slug.toLowerCase().includes(query));
      })
      .sort(compareByExpiry);
  }, [rows, search, tierFilter, statusFilter]);

  async function copyWallet(address: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedWallet(address);
      setTimeout(() => setCopiedWallet((current) => (current === address ? null : current)), 1500);
    } catch {
      // Clipboard access can be denied by the browser; the address is still visible to copy manually.
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Subscribers</h2>
          <p className={styles.sectionIntro}>
            Paywall management — every wallet on the platform, its tier and subscription status. Read-only; no
            payment controls here.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadSubscribers()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}

      {dataStatus === "unavailable" ? (
        <p className={styles.notice} role="status">
          {message}
        </p>
      ) : null}

      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <p className={styles.summaryValue}>{summary.activePro}</p>
          <p className={styles.summaryLabel}>active Pro subscribers</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryValue}>{summary.activeBondProSite}</p>
          <p className={styles.summaryLabel}>active Bond+Pro Site</p>
        </div>
        <div className={styles.summaryCard}>
          <p className={styles.summaryValue}>{summary.freeTier}</p>
          <p className={styles.summaryLabel}>free tier</p>
        </div>
      </div>

      <div className={styles.controls}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search wallet address or slug…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search subscribers by wallet address or slug"
        />
        <select
          className={styles.filterSelect}
          value={tierFilter}
          onChange={(event) => setTierFilter(event.target.value as SubscriberTier | "all")}
          aria-label="Filter by tier"
        >
          {TIER_FILTERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as SubscriberStatus | "all")}
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {!loading && visibleRows.length === 0 && rows.length === 0 ? (
        <p className={styles.empty}>No subscribers yet.</p>
      ) : null}
      {!loading && visibleRows.length === 0 && rows.length > 0 ? (
        <p className={styles.empty}>No subscribers match this search and filters.</p>
      ) : null}

      <ul className={styles.rowList}>
        {visibleRows.map((row) => (
          <li key={row.walletAddress} className={styles.row}>
            <div className={styles.rowTop}>
              <div className={styles.walletGroup}>
                <span className={styles.wallet}>{truncateWallet(row.walletAddress)}</span>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => void copyWallet(row.walletAddress)}
                >
                  {copiedWallet === row.walletAddress ? "Copied" : "Copy"}
                </button>
              </div>
              <span className={styles.badge} data-status={row.status}>
                {STATUS_LABEL[row.status]}
              </span>
            </div>

            <div className={styles.rowGrid}>
              <div>
                <p className={styles.fieldLabel}>Tier</p>
                <p className={styles.fieldValue}>{TIER_LABEL[row.tier]}</p>
              </div>
              <div>
                <p className={styles.fieldLabel}>Website slug(s)</p>
                <p className={styles.fieldValue}>{row.slugs.length > 0 ? row.slugs.join(", ") : "—"}</p>
              </div>
              <div>
                <p className={styles.fieldLabel}>X handle</p>
                <p className={styles.fieldValue}>{row.xHandle || "—"}</p>
              </div>
              <div>
                <p className={styles.fieldLabel}>Telegram</p>
                <p className={styles.fieldValue}>{row.telegram || "—"}</p>
              </div>
              <div>
                <p className={styles.fieldLabel}>Subscription start</p>
                <p className={styles.fieldValue}>{formatDate(row.startedAt)}</p>
              </div>
              <div>
                <p className={styles.fieldLabel}>Expiry</p>
                <p className={styles.fieldValue}>{formatDate(row.expiresAt)}</p>
              </div>
              <div>
                <p className={styles.fieldLabel}>Last payment</p>
                <p className={styles.fieldValue}>
                  {row.lastPaymentAmountEth ? `${row.lastPaymentAmountEth} ETH` : "—"}
                  {row.lastPaymentAt ? ` · ${formatDate(row.lastPaymentAt)}` : ""}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
