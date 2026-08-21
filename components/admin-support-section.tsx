"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./admin-support-section.module.css";

type SupportTicketCategory = "account" | "payments" | "site-builder" | "social-studio" | "publishing" | "other";
type SupportTicketStatus = "open" | "needs_user" | "solved" | "closed";

type SupportTicketMessage = {
  id: string;
  author: "user" | "owner";
  body: string;
  createdAt: string;
};

type SupportTicket = {
  id: string;
  walletAddress: string;
  category: SupportTicketCategory;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  diagnostics: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  messages: SupportTicketMessage[];
};

const STATUS_FILTERS: Array<{ id: SupportTicketStatus | "all"; label: string }> = [
  { id: "open", label: "Open" },
  { id: "needs_user", label: "Needs user" },
  { id: "solved", label: "Solved" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

const STATUS_BADGE_LABEL: Record<SupportTicketStatus, string> = {
  open: "Open",
  needs_user: "Needs user",
  solved: "Solved",
  closed: "Closed",
};

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function badgeClassName(status: SupportTicketStatus): string {
  if (status === "solved") return styles.badgeSolved;
  if (status === "closed") return styles.badgeClosed;
  if (status === "needs_user") return styles.badgeNeedsUser;
  return styles.badgeOpen;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function AdminSupportSection() {
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | "all">("open");
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/support?status=${statusFilter}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        window.location.replace("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "The support queue could not be loaded."));
      }
      const payload = (await response.json()) as { tickets: SupportTicket[] };
      setTickets(payload.tickets);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The support queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    queueMicrotask(() => void loadTickets());
  }, [loadTickets]);

  async function runAction(body: Record<string, unknown>): Promise<void> {
    const id = body.id as string;
    setBusyId(id);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/support/actions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "The action could not be completed."));
      }
      await loadTickets();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setBusyId(null);
    }
  }

  async function sendReply(id: string): Promise<void> {
    const replyBody = (replyDrafts[id] || "").trim();
    if (!replyBody) return;
    await runAction({ id, action: "reply", body: replyBody });
    setReplyDrafts((current) => ({ ...current, [id]: "" }));
  }

  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Support</h2>
          <p className={styles.sectionIntro}>
            Wallet-signed problem reports. Reply below to flip a ticket to &ldquo;Needs user&rdquo;; mark it Solved or
            Closed once it&apos;s resolved. Nothing here posts or replies automatically.
          </p>
        </div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadTickets()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

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

      {tickets && tickets.length === 0 ? <p className={styles.empty}>No tickets in this view.</p> : null}
      {!tickets && loading ? <p className={styles.empty}>Loading support tickets…</p> : null}

      <ul className={styles.itemList}>
        {(tickets || []).map((ticket) => {
          const expanded = expandedId === ticket.id;
          const busy = busyId === ticket.id;
          return (
            <li key={ticket.id} className={styles.item}>
              <button type="button" className={styles.itemSummary} onClick={() => setExpandedId(expanded ? null : ticket.id)}>
                <div className={styles.itemMeta}>
                  <p className={styles.itemTitle}>
                    {ticket.subject} <span className={styles.category}>{ticket.category}</span>
                  </p>
                  <p className={styles.itemSub}>
                    {ticket.walletAddress} · {formatTimestamp(ticket.createdAt)}
                  </p>
                </div>
                <span className={badgeClassName(ticket.status)}>{STATUS_BADGE_LABEL[ticket.status]}</span>
              </button>

              {expanded ? (
                <div className={styles.itemDetail}>
                  <p className={styles.body}>{ticket.body}</p>

                  <details className={styles.diagnostics}>
                    <summary>Diagnostics</summary>
                    <pre>{JSON.stringify(ticket.diagnostics, null, 2)}</pre>
                  </details>

                  <div className={styles.messageList}>
                    {ticket.messages.map((message) => (
                      <div key={message.id} className={message.author === "owner" ? styles.messageOwner : styles.messageUser}>
                        <span className={styles.messageAuthor}>{message.author === "owner" ? "Owner" : "User"}</span>
                        <p className={styles.messageText}>{message.body}</p>
                        <span className={styles.messageTime}>{formatTimestamp(message.createdAt)}</span>
                      </div>
                    ))}
                  </div>

                  <div className={styles.replyRow}>
                    <textarea
                      className={styles.replyInput}
                      value={replyDrafts[ticket.id] || ""}
                      maxLength={4000}
                      disabled={busy}
                      placeholder="Reply to the reporting wallet…"
                      onChange={(event) => setReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))}
                    />
                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        className={styles.replyButton}
                        disabled={busy || !(replyDrafts[ticket.id] || "").trim()}
                        onClick={() => void sendReply(ticket.id)}
                      >
                        {busy ? "Working…" : "Send reply"}
                      </button>
                      <button
                        type="button"
                        className={styles.solveButton}
                        disabled={busy || ticket.status === "solved"}
                        onClick={() => void runAction({ id: ticket.id, action: "status", status: "solved" })}
                      >
                        Mark solved
                      </button>
                      <button
                        type="button"
                        className={styles.closeButton}
                        disabled={busy || ticket.status === "closed"}
                        onClick={() => void runAction({ id: ticket.id, action: "status", status: "closed" })}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
