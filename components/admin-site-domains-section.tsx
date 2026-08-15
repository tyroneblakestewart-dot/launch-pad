"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./admin-site-domains-section.module.css";

type SiteDomainItem = {
  slug: string;
  name: string;
  ticker: string;
  visibility: string;
  ownerWalletAddress: string;
  pathUrl: string;
  subdomainUrl: string | null;
  canonicalUrl: string;
  entitlementTier: "test_access" | "bond_pro_site" | "pro" | "pro_bundle" | null;
  subdomainStatus: "active" | "eligible" | "path-only" | "draft" | "unavailable";
};

type SiteDomainsResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  routingEnabled: boolean;
  items: SiteDomainItem[];
};

const STATUS_LABEL: Record<SiteDomainItem["subdomainStatus"], string> = {
  active: "Subdomain active",
  eligible: "Eligible · DNS dormant",
  "path-only": "Path only",
  draft: "Eligible draft",
  unavailable: "Access check unavailable",
};

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || "Published-site domains could not be loaded.";
}

function shortWallet(value: string): string {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

function entitlementLabel(tier: SiteDomainItem["entitlementTier"]): string {
  if (tier === "test_access") return "TEST · admin allowlist";
  return tier || "free/path-only";
}

export function AdminSiteDomainsSection() {
  const [data, setData] = useState<SiteDomainsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/published-sites?page=${page}&pageSize=20`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) throw new Error(await readError(response));
      setData((await response.json()) as SiteDomainsResponse);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Published-site domains could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Published site domains</h2>
          <p className={styles.intro}>
            Canonical, path and paid subdomain URLs resolved from each site&apos;s
            owner wallet and the server subscriber store.
          </p>
        </div>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {data && !data.routingEnabled ? (
        <p className={styles.notice} role="status">
          Eligible subdomains are shown, but wildcard routing remains dormant
          until the Vercel domain/DNS setup is complete and
          HOODLUMS_SUBDOMAINS_ENABLED is true.
        </p>
      ) : null}
      {!loading && data?.items.length === 0 ? (
        <p className={styles.empty}>No published sites yet.</p>
      ) : null}

      <ul className={styles.list}>
        {(data?.items || []).map((site) => (
          <li key={site.slug} className={styles.item}>
            <div className={styles.itemTop}>
              <p className={styles.name}>{site.name} (${site.ticker})</p>
              <span className={styles.badge}>{STATUS_LABEL[site.subdomainStatus]}</span>
            </div>
            <div className={styles.urlGrid}>
              <span className={styles.label}>Canonical</span>
              <span className={styles.value}>
                <a href={site.canonicalUrl} target="_blank" rel="noreferrer">
                  {site.canonicalUrl}
                </a>
              </span>

              <span className={styles.label}>Path fallback</span>
              <span className={styles.value}>
                <a href={site.pathUrl} target="_blank" rel="noreferrer">
                  {site.pathUrl}
                </a>
              </span>

              <span className={styles.label}>Paid subdomain</span>
              <span className={styles.value}>
                {site.subdomainUrl ? (
                  <a href={site.subdomainUrl} target="_blank" rel="noreferrer">
                    {site.subdomainUrl}
                  </a>
                ) : (
                  "Not entitled"
                )}
              </span>

              <span className={styles.label}>Owner / access</span>
              <span className={styles.value}>
                {shortWallet(site.ownerWalletAddress)} · {entitlementLabel(site.entitlementTier)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {data && data.totalPages > 1 ? (
        <div className={styles.pagination}>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>
            Previous
          </button>
          <span>Page {data.page} of {data.totalPages}</span>
          <button type="button" onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))} disabled={page >= data.totalPages || loading}>
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}
