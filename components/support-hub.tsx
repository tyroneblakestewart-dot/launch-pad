"use client";

import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom } from "viem";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./support-hub.module.css";

type AccountsChangedHandler = (accounts: string[]) => void;

// getInjectedEvmProvider()'s shared Eip1193Provider type only declares
// `request` — widen locally for the accountsChanged listener, matching
// components/account-wallet-bridge.tsx's own local extension.
type WalletProviderWithEvents = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: "accountsChanged", handler: AccountsChangedHandler) => void;
  removeListener?: (event: "accountsChanged", handler: AccountsChangedHandler) => void;
};

type SupportTicketCategory = "account" | "payments" | "site-builder" | "social-studio" | "publishing" | "other";
type SupportTicketStatus = "open" | "needs_user" | "solved" | "closed";

const CATEGORY_OPTIONS: { id: SupportTicketCategory; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "payments", label: "Payments" },
  { id: "site-builder", label: "Site builder" },
  { id: "social-studio", label: "AI Social Studio" },
  { id: "publishing", label: "Publishing" },
  { id: "other", label: "Something else" },
];

const STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: "Open",
  needs_user: "Needs your reply",
  solved: "Solved",
  closed: "Closed",
};

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 4000;
const REPLYABLE_STATUSES = new Set<SupportTicketStatus>(["open", "needs_user"]);

type SupportTicketMessage = {
  id: string;
  author: "user" | "owner";
  body: string;
  createdAt: string;
};

type SupportTicket = {
  id: string;
  category: SupportTicketCategory;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  createdAt: string;
  updatedAt: string;
  messages: SupportTicketMessage[];
};

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<T>;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function signSupportChallenge(purpose: "support:ticket-create" | "support:ticket-reply", payload: Record<string, string>) {
  const provider = getInjectedEvmProvider();
  if (!provider) throw new Error("Connect an EVM wallet first.");
  const walletClient = createWalletClient({ transport: custom(provider) });
  const [account] = await walletClient.getAddresses();
  if (!account) throw new Error("Connect an EVM wallet first.");
  const walletChainId = await walletClient.getChainId();

  const challengeResponse = await fetch("/api/support/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: account, walletChainId, purpose, payload }),
  });
  const challenge = await readJsonResponse<{ challengeId: string; nonce: string; message: string }>(
    challengeResponse,
    "Could not start that action.",
  );
  const signature = await walletClient.signMessage({ account, message: challenge.message });
  return { account, challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}

type SupportHubProps = {
  heroEyebrow?: string;
  heroTitle?: string;
  heroIntro?: string;
};

const DEFAULT_HERO_EYEBROW = "SUPPORT";
const DEFAULT_HERO_TITLE = "Report a problem";
const DEFAULT_HERO_INTRO =
  "Tell us what happened. We attach your plan and connection status automatically — never your credentials — so we can help faster.";

export function SupportHub({
  heroEyebrow = DEFAULT_HERO_EYEBROW,
  heroTitle = DEFAULT_HERO_TITLE,
  heroIntro = DEFAULT_HERO_INTRO,
}: SupportHubProps = {}) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [category, setCategory] = useState<SupportTicketCategory>("other");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);

  const loadTickets = useCallback(async (wallet: string) => {
    try {
      const response = await fetch(`/api/support/tickets?walletAddress=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const payload = await readJsonResponse<{ tickets: SupportTicket[] }>(response, "Your tickets could not be loaded.");
      setTickets(payload.tickets);
      setTicketsError(null);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : "Your tickets could not be loaded.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const provider = getInjectedEvmProvider() as WalletProviderWithEvents | undefined;
    if (!provider) return;
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (!cancelled && Array.isArray(accounts) && accounts[0]) setWalletAddress(accounts[0] as string);
      })
      .catch(() => {});

    // Keep the displayed ticket history following whichever wallet/account is
    // actually active — a switch or disconnect in the extension must clear
    // stale tickets immediately rather than keep showing the previous
    // wallet's history (issue #393 review).
    const handleAccountsChanged: AccountsChangedHandler = (accounts) => {
      if (cancelled) return;
      const nextAccount = Array.isArray(accounts) ? accounts[0] : undefined;
      setWalletAddress(nextAccount || null);
    };
    provider.on?.("accountsChanged", handleAccountsChanged);

    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      if (walletAddress) void loadTickets(walletAddress);
      else setTickets(null);
    });
  }, [walletAddress, loadTickets]);

  const connectWallet = useCallback(async () => {
    const provider = getInjectedEvmProvider();
    if (!provider) {
      setSubmitError("No EVM wallet was found in this browser.");
      return;
    }
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts?.[0]) setWalletAddress(accounts[0]);
    } catch {
      setSubmitError("Wallet connection was cancelled.");
    }
  }, []);

  async function handleSubmit() {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitted(false);
    try {
      const auth = await signSupportChallenge("support:ticket-create", { category, subject: trimmedSubject, body: trimmedBody });
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject: trimmedSubject,
          body: trimmedBody,
          challengeId: auth.challengeId,
          nonce: auth.nonce,
          signature: auth.signature,
        }),
      });
      await readJsonResponse<{ ticket: SupportTicket }>(response, "Your report could not be submitted.");
      setSubject("");
      setBody("");
      setSubmitted(true);
      await loadTickets(auth.account);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Your report could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReply(ticketId: string) {
    const draft = (replyDrafts[ticketId] || "").trim();
    if (!draft || replyingId) return;
    setReplyingId(ticketId);
    setReplyError(null);
    try {
      const auth = await signSupportChallenge("support:ticket-reply", { ticketId, body: draft });
      const response = await fetch(`/api/support/tickets/${encodeURIComponent(ticketId)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft, challengeId: auth.challengeId, nonce: auth.nonce, signature: auth.signature }),
      });
      await readJsonResponse<{ ticket: SupportTicket }>(response, "Your reply could not be sent.");
      setReplyDrafts((current) => ({ ...current, [ticketId]: "" }));
      await loadTickets(auth.account);
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "Your reply could not be sent.");
    } finally {
      setReplyingId(null);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{heroEyebrow}</p>
          <h1 className={styles.title}>{heroTitle}</h1>
          <p className={styles.intro}>{heroIntro}</p>
        </header>

        {!walletAddress ? (
          <button type="button" className={styles.connectButton} onClick={() => void connectWallet()}>
            Connect wallet to report a problem
          </button>
        ) : (
          <section className={styles.panel} aria-labelledby="support-form-title">
            <h2 id="support-form-title" className={styles.panelTitle}>
              New report
            </h2>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Category</span>
              <select
                className={styles.select}
                value={category}
                disabled={submitting}
                onChange={(event) => setCategory(event.target.value as SupportTicketCategory)}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Subject</span>
              <input
                className={styles.input}
                type="text"
                value={subject}
                maxLength={MAX_SUBJECT_LENGTH}
                placeholder="Short summary"
                disabled={submitting}
                onChange={(event) => setSubject(event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>What happened?</span>
              <textarea
                className={styles.textarea}
                value={body}
                maxLength={MAX_BODY_LENGTH}
                placeholder="Describe the problem, what you expected, and any steps to reproduce it."
                disabled={submitting}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>

            {submitError ? (
              <p className={styles.errorBanner} role="alert">
                {submitError}
              </p>
            ) : null}
            {submitted ? <p className={styles.successBanner}>Report sent. We&apos;ll reply here.</p> : null}

            <button
              type="button"
              className={styles.submitButton}
              disabled={submitting || !subject.trim() || !body.trim()}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Sending…" : "Send report"}
            </button>
          </section>
        )}

        {walletAddress ? (
          <section className={styles.panel} aria-labelledby="support-history-title">
            <h2 id="support-history-title" className={styles.panelTitle}>
              Your reports
            </h2>

            {ticketsError ? (
              <p className={styles.errorBanner} role="alert">
                {ticketsError}
              </p>
            ) : null}
            {tickets && tickets.length === 0 ? <p className={styles.emptyState}>No reports yet.</p> : null}
            {!tickets && !ticketsError ? <p className={styles.emptyState}>Loading your reports…</p> : null}

            <ul className={styles.ticketList}>
              {(tickets || []).map((ticket) => {
                const expanded = expandedId === ticket.id;
                return (
                  <li key={ticket.id} className={styles.ticket}>
                    <button
                      type="button"
                      className={styles.ticketSummary}
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : ticket.id)}
                    >
                      <span className={styles.ticketSubject}>{ticket.subject}</span>
                      <span className={styles.ticketStatus}>{STATUS_LABEL[ticket.status]}</span>
                    </button>

                    {expanded ? (
                      <div className={styles.ticketBody}>
                        <p className={styles.ticketDescription}>{ticket.body}</p>
                        <div className={styles.messageList}>
                          {ticket.messages.map((message) => (
                            <div
                              key={message.id}
                              className={message.author === "owner" ? styles.messageOwner : styles.messageUser}
                            >
                              <span className={styles.messageAuthor}>{message.author === "owner" ? "HOODLUMS" : "You"}</span>
                              <p className={styles.messageText}>{message.body}</p>
                              <span className={styles.messageTime}>{formatTimestamp(message.createdAt)}</span>
                            </div>
                          ))}
                        </div>

                        {REPLYABLE_STATUSES.has(ticket.status) ? (
                          <div className={styles.replyRow}>
                            <textarea
                              className={styles.replyInput}
                              value={replyDrafts[ticket.id] || ""}
                              maxLength={MAX_BODY_LENGTH}
                              placeholder="Add more details…"
                              disabled={replyingId === ticket.id}
                              onChange={(event) =>
                                setReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))
                              }
                            />
                            <button
                              type="button"
                              className={styles.replyButton}
                              disabled={replyingId === ticket.id || !(replyDrafts[ticket.id] || "").trim()}
                              onClick={() => void handleReply(ticket.id)}
                            >
                              {replyingId === ticket.id ? "Sending…" : "Reply"}
                            </button>
                          </div>
                        ) : (
                          <p className={styles.closedNote}>This report is {STATUS_LABEL[ticket.status].toLowerCase()}.</p>
                        )}
                        {replyError && replyingId === null ? (
                          <p className={styles.errorBanner} role="alert">
                            {replyError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
