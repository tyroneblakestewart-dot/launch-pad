"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  ADMIN_ACCOUNT_SECTIONS,
  type AdminAccountSearchResponse,
  type AdminAccountSectionId,
  type AdminAccountSectionResponse,
  type AdminAccountSummary,
} from "@/lib/admin-accounts";
import styles from "./admin-accounts-section.module.css";

const SECTION_LABELS: Record<AdminAccountSectionId, string> = {
  timeline: "Timeline",
  payments: "Payments",
  reminders: "Lifecycle & reminders",
  tokens: "Tokens launched",
  sites: "Sites published",
  hoodchat: "Hoodchat",
  reports: "Reports",
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function shortWallet(walletAddress: string): string {
  return walletAddress.length > 16
    ? `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}`
    : walletAddress;
}

export function AdminAccountsSection() {
  const [query, setQuery] = useState("");
  const [searchResponse, setSearchResponse] = useState<AdminAccountSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminAccountSummary | null>(null);
  const [activeSection, setActiveSection] = useState<AdminAccountSectionId>("timeline");
  const [sectionResponse, setSectionResponse] = useState<AdminAccountSectionResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function checkedJson<T>(response: Response, fallback: string): Promise<T> {
    if (response.status === 401) {
      window.location.replace("/admin");
      throw new Error("Admin sign-in is required.");
    }
    if (!response.ok) throw new Error(await readError(response, fallback));
    return (await response.json()) as T;
  }

  async function searchAccounts(page = 1) {
    const searchQuery = query.trim();
    setSelectedWallet(null);
    setSummary(null);
    setSectionResponse(null);
    setError(null);

    if (!searchQuery) {
      setSearchResponse(null);
      return;
    }

    setSearching(true);
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        page: String(page),
        pageSize: "20",
      });
      const response = await fetch(`/api/admin/accounts?${params}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      setSearchResponse(
        await checkedJson<AdminAccountSearchResponse>(response, "Account search failed."),
      );
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Account search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function loadSection(
    walletAddress: string,
    section: AdminAccountSectionId,
    page = 1,
  ) {
    const params = new URLSearchParams({
      section,
      page: String(page),
      pageSize: "20",
    });
    const response = await fetch(
      `/api/admin/accounts/${encodeURIComponent(walletAddress)}?${params}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    return checkedJson<AdminAccountSectionResponse>(
      response,
      `${SECTION_LABELS[section]} could not be loaded.`,
    );
  }

  async function openAccount(walletAddress: string) {
    setSelectedWallet(walletAddress);
    setSummary(null);
    setSectionResponse(null);
    setActiveSection("timeline");
    setLoadingDetail(true);
    setError(null);

    try {
      const [summaryResponse, timelineResponse] = await Promise.all([
        fetch(`/api/admin/accounts/${encodeURIComponent(walletAddress)}`, {
          cache: "no-store",
          credentials: "same-origin",
        }).then((response) =>
          checkedJson<AdminAccountSummary>(response, "Account summary could not be loaded."),
        ),
        loadSection(walletAddress, "timeline"),
      ]);
      setSummary(summaryResponse);
      setSectionResponse(timelineResponse);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "Account detail could not be loaded.");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function selectSection(section: AdminAccountSectionId, page = 1) {
    if (!selectedWallet) return;
    setActiveSection(section);
    setSectionResponse(null);
    setLoadingDetail(true);
    setError(null);
    try {
      setSectionResponse(await loadSection(selectedWallet, section, page));
    } catch (sectionError) {
      setError(sectionError instanceof Error ? sectionError.message : "Account records could not be loaded.");
    } finally {
      setLoadingDetail(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void searchAccounts(1);
  }

  async function copyWallet() {
    if (!selectedWallet) return;
    try {
      await navigator.clipboard.writeText(selectedWallet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // The complete address stays visible for manual copying.
    }
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2>Accounts</h2>
          <p>
            Search one wallet or linked Telegram username, then inspect its
            existing subscription, payments, publishing and Hoodchat records.
          </p>
        </div>
      </header>

      <form className={styles.searchForm} onSubmit={submitSearch}>
        <label>
          <span>Wallet address or Telegram username</span>
          <input
            type="search"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            placeholder="0x… or @username"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search accounts"}
        </button>
      </form>

      <p className={styles.costNote}>
        Read-only support view. Records are assembled from existing tables;
        no per-request activity log is written.
      </p>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {!selectedWallet && searchResponse ? (
        <section className={styles.results} aria-labelledby="account-search-results">
          <div className={styles.resultsHeading}>
            <h3 id="account-search-results">Search results</h3>
            <span>{searchResponse.total} account{searchResponse.total === 1 ? "" : "s"}</span>
          </div>

          {searchResponse.items.length === 0 ? (
            <p className={styles.empty}>No account matched that wallet or Telegram username.</p>
          ) : (
            <ul className={styles.resultList}>
              {searchResponse.items.map((account) => (
                <li key={account.walletAddress}>
                  <button type="button" onClick={() => void openAccount(account.walletAddress)}>
                    <span className={styles.resultIdentity}>
                      <b>{shortWallet(account.walletAddress)}</b>
                      <small>{account.telegramUsername || "No linked Telegram username"}</small>
                    </span>
                    <span className={styles.resultMeta}>
                      <em data-status={account.status}>{account.status}</em>
                      <small>{account.paymentCount} payments · {account.siteCount} sites</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searchResponse.totalPages > 1 ? (
            <div className={styles.pagination}>
              <button
                type="button"
                disabled={searching || searchResponse.page <= 1}
                onClick={() => void searchAccounts(searchResponse.page - 1)}
              >
                Previous
              </button>
              <span>Page {searchResponse.page} of {searchResponse.totalPages}</span>
              <button
                type="button"
                disabled={searching || searchResponse.page >= searchResponse.totalPages}
                onClick={() => void searchAccounts(searchResponse.page + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedWallet ? (
        <section className={styles.detail} aria-labelledby="account-detail-title">
          <div className={styles.detailTop}>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => {
                setSelectedWallet(null);
                setSummary(null);
                setSectionResponse(null);
                setError(null);
              }}
            >
              ← Back to results
            </button>
            <div className={styles.walletLine}>
              <h3 id="account-detail-title">{selectedWallet}</h3>
              <button type="button" onClick={() => void copyWallet()}>{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>

          {summary ? (
            <>
              <div className={styles.statusGrid}>
                <article>
                  <span>Subscription</span>
                  <b>{summary.subscription.tier || "No subscription"}</b>
                  <small data-active={summary.subscription.active ? "true" : "false"}>
                    {summary.subscription.status} · {summary.subscription.active ? "server unlocked" : "server locked"}
                  </small>
                </article>
                <article>
                  <span>Paid window</span>
                  <b>{summary.subscription.daysRemaining} days remaining</b>
                  <small>{formatDate(summary.subscription.paidFrom)} → {formatDate(summary.subscription.paidUntil)}</small>
                </article>
                <article>
                  <span>Telegram link</span>
                  <b>{summary.telegram.linked ? summary.telegram.username || "Linked" : "Not linked"}</b>
                  <small>{summary.telegram.linkedAt ? `Linked ${formatDate(summary.telegram.linkedAt)}` : "No reminder destination"}</small>
                </article>
                <article>
                  <span>Last payment</span>
                  <b>{summary.subscription.lastPaymentAmount || "—"} {summary.subscription.lastPaymentAsset || ""}</b>
                  <small>{summary.counts.payments} verified payment event{summary.counts.payments === 1 ? "" : "s"}</small>
                </article>
              </div>

              <div className={styles.countGrid}>
                <span><b>{summary.counts.tokensLaunched}</b> tokens launched</span>
                <span><b>{summary.counts.sitesPublished}</b> sites published</span>
                <span><b>{summary.counts.hoodchatMessages + summary.counts.tokenChatMessages}</b> Hoodchat posts</span>
                <span><b>{summary.counts.reportsAgainst}</b> reports against</span>
                <span><b>{summary.counts.hiddenMessages}</b> hidden posts</span>
                <span><b>{summary.counts.reminders}</b> reminder events</span>
              </div>
            </>
          ) : null}

          <nav className={styles.sectionTabs} aria-label="Account record sections">
            {ADMIN_ACCOUNT_SECTIONS.map((section) => (
              <button
                key={section}
                type="button"
                aria-current={section === activeSection ? "page" : undefined}
                className={section === activeSection ? styles.sectionTabActive : styles.sectionTab}
                onClick={() => void selectSection(section)}
                disabled={loadingDetail && section === activeSection}
              >
                {SECTION_LABELS[section]}
              </button>
            ))}
          </nav>

          {loadingDetail ? <p className={styles.loading}>Loading account records…</p> : null}

          {!loadingDetail && sectionResponse ? (
            <section className={styles.records}>
              <div className={styles.recordsHeading}>
                <h4>{SECTION_LABELS[sectionResponse.section]}</h4>
                <span>{sectionResponse.total} record{sectionResponse.total === 1 ? "" : "s"}</span>
              </div>

              {sectionResponse.items.length === 0 ? (
                <p className={styles.empty}>No existing records in this section.</p>
              ) : (
                <ol className={styles.recordList}>
                  {sectionResponse.items.map((record) => (
                    <li key={`${record.kind}:${record.id}`}>
                      <div className={styles.recordTop}>
                        <span data-kind={record.kind}>{record.kind}</span>
                        <time dateTime={record.occurredAt}>{formatDate(record.occurredAt)}</time>
                      </div>
                      <h5>{record.title}</h5>
                      <p>{record.detail}</p>
                      {record.transactionHash ? <code>{record.transactionHash}</code> : null}
                      {record.metadata.length ? (
                        <dl>
                          {record.metadata.map((entry) => (
                            <div key={`${record.id}:${entry.label}`}>
                              <dt>{entry.label}</dt>
                              <dd>{entry.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}

              {sectionResponse.totalPages > 1 ? (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    disabled={loadingDetail || sectionResponse.page <= 1}
                    onClick={() => void selectSection(activeSection, sectionResponse.page - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {sectionResponse.page} of {sectionResponse.totalPages}</span>
                  <button
                    type="button"
                    disabled={loadingDetail || sectionResponse.page >= sectionResponse.totalPages}
                    onClick={() => void selectSection(activeSection, sectionResponse.page + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
