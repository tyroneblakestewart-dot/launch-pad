/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./admin-outreach-section.module.css";

type OutreachTouch = "first" | "followup";
type OutreachStatus = "pending" | "posted" | "dismissed" | "failed";

type OutreachQueueItem = {
  id: string;
  touch: OutreachTouch;
  status: OutreachStatus;
  tokenMint: string;
  tokenName: string;
  tokenTicker: string;
  tokenArtworkUrl: string;
  tokenUrl: string;
  progressPercent: number;
  creatorXHandle: string | null;
  templateKey: string;
  body: string;
  errorMessage: string | null;
  xPostId: string | null;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
  dismissedAt: string | null;
};

type OutreachResponse = { items: OutreachQueueItem[]; postingConfigured: boolean };

const STATUS_FILTERS: Array<{ id: OutreachStatus | "all"; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "posted", label: "Posted" },
  { id: "failed", label: "Failed" },
  { id: "dismissed", label: "Dismissed" },
  { id: "all", label: "All" },
];

const STATUS_BADGE_LABEL: Record<OutreachStatus, string> = {
  pending: "Pending",
  posted: "Posted",
  dismissed: "Dismissed",
  failed: "Failed",
};

export const OUTREACH_DORMANT_NOTICE = "posting not configured — outreach is dormant";

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function badgeClassName(status: OutreachStatus): string {
  if (status === "posted") return styles.badgePosted;
  if (status === "failed") return styles.badgeFailed;
  if (status === "dismissed") return styles.badgeDismissed;
  return styles.badgePending;
}

export function AdminOutreachSection() {
  const [statusFilter, setStatusFilter] = useState<OutreachStatus | "all">("pending");
  const [items, setItems] = useState<OutreachQueueItem[] | null>(null);
  const [postingConfigured, setPostingConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/outreach?status=${statusFilter}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "The outreach queue could not be loaded."));
      }
      const payload = (await response.json()) as OutreachResponse;
      setItems(payload.items);
      setPostingConfigured(payload.postingConfigured);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The outreach queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    queueMicrotask(() => void loadItems());
  }, [loadItems]);

  async function runAction(id: string, action: "approve" | "dismiss" | "edit", editedBody?: string): Promise<void> {
    setBusyId(id);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/outreach/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...(editedBody !== undefined ? { body: editedBody } : {}) }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The action could not be completed."));
      }
      if (action === "edit") setEditingId(null);
      await loadItems();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(item: OutreachQueueItem): void {
    setEditingId(item.id);
    setEditValue(item.body);
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Outreach</h2>
          <p className={styles.sectionIntro}>
            Congratulatory X drafts for graduating pump.fun tokens. Nothing posts automatically — approve, edit, or
            dismiss each draft below. Ships dormant: draft generation only runs once OUTREACH_QUEUE_ENABLED is
            turned on, and posting stays off until all four X_OUTREACH_* credentials are configured.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadItems()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!postingConfigured ? <p className={styles.dormantNotice}>{OUTREACH_DORMANT_NOTICE}</p> : null}
      {loadError ? (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.error} role="alert">
          {actionError}
        </p>
      ) : null}

      <div className={styles.filters}>
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={filter.id === statusFilter}
            className={filter.id === statusFilter ? styles.filterActive : styles.filter}
            onClick={() => setStatusFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {items && items.length === 0 ? <p className={styles.empty}>No drafts in this view.</p> : null}
      {!items && loading ? <p className={styles.empty}>Loading outreach queue…</p> : null}

      <ul className={styles.itemList}>
        {(items || []).map((item) => {
          const busy = busyId === item.id;
          const editing = editingId === item.id;
          return (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemTop}>
                {item.tokenArtworkUrl ? (
                  <img className={styles.artwork} src={item.tokenArtworkUrl} alt="" />
                ) : (
                  <div className={styles.artworkFallback}>{item.tokenTicker.slice(0, 1) || "?"}</div>
                )}
                <div className={styles.itemMeta}>
                  <p className={styles.itemTitle}>
                    {item.tokenName} <span className={styles.ticker}>${item.tokenTicker}</span>
                  </p>
                  <p className={styles.itemSub}>
                    {Math.round(item.progressPercent)}% · {item.touch === "first" ? "First touch" : "Follow-up"} ·{" "}
                    {item.creatorXHandle ? `will @-mention @${item.creatorXHandle}` : "no creator handle to mention"}
                  </p>
                </div>
                <span className={badgeClassName(item.status)}>{STATUS_BADGE_LABEL[item.status]}</span>
              </div>

              {editing ? (
                <textarea
                  className={styles.textInput}
                  value={editValue}
                  disabled={busy}
                  maxLength={500}
                  onChange={(event) => setEditValue(event.target.value)}
                />
              ) : (
                <p className={styles.body}>{item.body}</p>
              )}

              {item.status === "failed" && item.errorMessage ? (
                <p className={styles.failureReason}>Failed: {item.errorMessage}</p>
              ) : null}

              {item.status === "pending" ? (
                <div className={styles.itemActions}>
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className={styles.saveButton}
                        disabled={busy || !editValue.trim()}
                        onClick={() => void runAction(item.id, "edit", editValue.trim())}
                      >
                        {busy ? "Saving…" : "Save edit"}
                      </button>
                      <button
                        type="button"
                        className={styles.discardButton}
                        disabled={busy}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.approveButton}
                        disabled={busy || !postingConfigured}
                        title={!postingConfigured ? OUTREACH_DORMANT_NOTICE : undefined}
                        onClick={() => void runAction(item.id, "approve")}
                      >
                        {busy ? "Working…" : "Approve"}
                      </button>
                      <button type="button" className={styles.editButton} disabled={busy} onClick={() => startEdit(item)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.dismissButton}
                        disabled={busy}
                        onClick={() => void runAction(item.id, "dismiss")}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
