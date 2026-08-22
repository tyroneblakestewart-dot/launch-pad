"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./admin-subscribers-section.module.css";

type SubscriberTier = "free" | "bond" | "bond_site" | "bond_pro_site" | "pro" | "pro_bundle";
type SubscriberStatus = "active" | "expiring" | "expired" | "free";

type SubscriberPayment = {
  transactionHash: string;
  planId: "bond-pro-site" | "pro" | "pro-bundle";
  billingPeriod: "one_off" | "monthly" | "upfront";
  asset: string;
  amountDisplay: string;
  amountUsdCents: number;
  paidFrom: string | null;
  paidUntil: string | null;
  confirmedAt: string;
};

type SocialProjectSlot = {
  projectId: string;
  displayName: string;
  registeredAt: string;
};

type SubscriberRow = {
  walletAddress: string;
  tier: SubscriberTier;
  status: SubscriberStatus;
  bespokeSiteAccess: boolean;
  slugs: string[];
  xHandle: string | null;
  telegram: string | null;
  telegramLinked: boolean;
  startedAt: string | null;
  expiresAt: string | null;
  paidFrom: string | null;
  paidUntil: string | null;
  lastPaymentAsset: string | null;
  lastPaymentAmount: string | null;
  lastPaymentAmountEth: string | null;
  lastPaymentAt: string | null;
  paymentHistory: SubscriberPayment[];
  socialProjectSlots: SocialProjectSlot[];
};

type SubscribersResponse = {
  status: "ready" | "unavailable";
  message: string;
  rows: SubscriberRow[];
};

const TIER_LABEL: Record<SubscriberTier, string> = {
  free: "Free",
  bond: "Bond",
  bond_site: "Bond + Site",
  bond_pro_site: "Bond + Pro Site",
  pro: "Pro",
  pro_bundle: "Pro Bundle",
};

const STATUS_LABEL: Record<SubscriberStatus, string> = {
  active: "Active",
  expiring: "Expiring",
  expired: "Expired",
  free: "Free tier",
};

const TIER_FILTERS: Array<{ id: SubscriberTier | "all"; label: string }> = [
  { id: "all", label: "All tiers" },
  ...Object.entries(TIER_LABEL).map(([id, label]) => ({ id: id as SubscriberTier, label })),
];

const STATUS_FILTERS: Array<{ id: SubscriberStatus | "all"; label: string }> = [
  { id: "all", label: "All statuses" },
  ...Object.entries(STATUS_LABEL).map(([id, label]) => ({ id: id as SubscriberStatus, label })),
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

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function compareByExpiry(a: SubscriberRow, b: SubscriberRow): number {
  if (!a.paidUntil && !b.paidUntil) return a.walletAddress.localeCompare(b.walletAddress);
  if (!a.paidUntil) return 1;
  if (!b.paidUntil) return -1;
  return new Date(a.paidUntil).getTime() - new Date(b.paidUntil).getTime();
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

  const summary = useMemo(() => ({
    active: rows.filter((row) => row.status === "active").length,
    expiring: rows.filter((row) => row.status === "expiring").length,
    expired: rows.filter((row) => row.status === "expired").length,
  }), [rows]);

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
      // Address remains visible for manual copying.
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Subscribers</h2>
          <p className={styles.sectionIntro}>
            Server-verified plan state for every wallet, including bespoke AI-site eligibility and complete payment history.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadSubscribers()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      {dataStatus === "unavailable" ? <p className={styles.notice} role="status">{message}</p> : null}

      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}><p className={styles.summaryValue}>{summary.active}</p><p className={styles.summaryLabel}>active</p></div>
        <div className={styles.summaryCard}><p className={styles.summaryValue}>{summary.expiring}</p><p className={styles.summaryLabel}>expiring within 5 days</p></div>
        <div className={styles.summaryCard}><p className={styles.summaryValue}>{summary.expired}</p><p className={styles.summaryLabel}>expired · data retained</p></div>
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
        <select className={styles.filterSelect} value={tierFilter} onChange={(event) => setTierFilter(event.target.value as SubscriberTier | "all")} aria-label="Filter by tier">
          {TIER_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select className={styles.filterSelect} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SubscriberStatus | "all")} aria-label="Filter by status">
          {STATUS_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>

      {!loading && visibleRows.length === 0 && rows.length === 0 ? <p className={styles.empty}>No subscribers yet.</p> : null}
      {!loading && visibleRows.length === 0 && rows.length > 0 ? <p className={styles.empty}>No subscribers match this search and filters.</p> : null}

      <ul className={styles.rowList}>
        {visibleRows.map((row) => (
          <li key={row.walletAddress} className={styles.row}>
            <div className={styles.rowTop}>
              <div className={styles.walletGroup}>
                <span className={styles.wallet}>{truncateWallet(row.walletAddress)}</span>
                <button type="button" className={styles.copyButton} onClick={() => void copyWallet(row.walletAddress)}>
                  {copiedWallet === row.walletAddress ? "Copied" : "Copy"}
                </button>
              </div>
              <span className={styles.badge} data-status={row.status}>{STATUS_LABEL[row.status]}</span>
            </div>

            <div className={styles.rowGrid}>
              <div><p className={styles.fieldLabel}>Plan</p><p className={styles.fieldValue}>{TIER_LABEL[row.tier]}</p></div>
              <div><p className={styles.fieldLabel}>Bespoke AI site</p><p className={styles.fieldValue}>{row.bespokeSiteAccess ? "Allowed by server entitlement" : "Blocked · upgrade or renew"}</p></div>
              <div><p className={styles.fieldLabel}>Paid from</p><p className={styles.fieldValue}>{formatDate(row.paidFrom)}</p></div>
              <div><p className={styles.fieldLabel}>Paid until</p><p className={styles.fieldValue}>{formatDate(row.paidUntil)}</p></div>
              <div><p className={styles.fieldLabel}>Last payment</p><p className={styles.fieldValue}>{row.lastPaymentAmount ? `${row.lastPaymentAmount} ${row.lastPaymentAsset || ""}` : "—"}{row.lastPaymentAt ? ` · ${formatDate(row.lastPaymentAt)}` : ""}</p></div>
              <div><p className={styles.fieldLabel}>Telegram reminders</p><p className={styles.fieldValue}>{row.telegramLinked ? row.telegram || "Linked" : "Not linked"}</p></div>
              <div><p className={styles.fieldLabel}>Website slug(s)</p><p className={styles.fieldValue}>{row.slugs.length ? row.slugs.join(", ") : "—"}</p></div>
              <div><p className={styles.fieldLabel}>X handle</p><p className={styles.fieldValue}>{row.xHandle || "—"}</p></div>
              <div><p className={styles.fieldLabel}>Subscription start</p><p className={styles.fieldValue}>{formatDate(row.startedAt)}</p></div>
            </div>

            <details className={styles.history}>
              <summary>Payment history ({row.paymentHistory.length})</summary>
              {row.paymentHistory.length === 0 ? (
                <p className={styles.empty}>No verified payment history.</p>
              ) : (
                <ol className={styles.historyList}>
                  {row.paymentHistory.map((payment) => (
                    <li key={payment.transactionHash}>
                      <b>{payment.billingPeriod === "upfront" ? "3 months upfront" : payment.billingPeriod === "monthly" ? "Monthly renewal" : "One-off"}</b>
                      <span>{payment.amountDisplay} {payment.asset} · {formatUsd(payment.amountUsdCents)}</span>
                      <small>{formatDate(payment.confirmedAt)} · {formatDate(payment.paidFrom)} → {formatDate(payment.paidUntil)}</small>
                      <code>{payment.transactionHash}</code>
                    </li>
                  ))}
                </ol>
              )}
            </details>

            <details className={styles.history}>
              <summary>AI Social Studio project slots ({row.socialProjectSlots.length})</summary>
              {row.socialProjectSlots.length === 0 ? (
                <p className={styles.empty}>No active project slots. Release them from the Project Slots section.</p>
              ) : (
                <ol className={styles.historyList}>
                  {row.socialProjectSlots.map((slot) => (
                    <li key={slot.projectId}>
                      <b>{slot.displayName}</b>
                      <small>Registered {formatDate(slot.registeredAt)}</small>
                      <code>{slot.projectId}</code>
                    </li>
                  ))}
                </ol>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
