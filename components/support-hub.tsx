"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { createWalletClient, custom } from "viem";
import {
  ARTWORK_COMPRESSION_STEPS,
  MAX_ARTWORK_SOURCE_BYTES,
  MAX_COMPRESSED_ARTWORK_BYTES,
  TARGET_COMPRESSED_ARTWORK_BYTES,
  estimateDataUrlLength,
  fitArtworkDimensions,
} from "@/lib/artwork-compression";
import { writeSupportLastSeen } from "@/lib/support-unread";
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
  attachmentDataUrl: string | null;
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

// Optional screenshot attachment on a new ticket (issue #398). Client-side
// downscale/re-encode follows components/artwork-upload-controller.tsx's
// "large files auto-optimised" pattern, targeting the same
// MAX_COMPRESSED_ARTWORK_BYTES ceiling — but only PNG/JPEG/WEBP are
// accepted here (no GIF/AVIF/HEIC), matching the server's mime allowlist in
// lib/server/support-ticket-attachment.ts, which is the authoritative check.
const ALLOWED_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1)} MB`;
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This image could not be opened by the browser. Try a PNG, JPG or WEBP screenshot."));
    };
    image.src = objectUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

async function optimiseScreenshotToDataUrl(file: File): Promise<string> {
  const image = await loadImageFromFile(file);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("The selected image has no readable dimensions.");
  }

  let smallest: string | null = null;

  for (const type of ["image/webp", "image/jpeg"] as const) {
    for (const step of ARTWORK_COMPRESSION_STEPS) {
      const { width, height } = fitArtworkDimensions(image.naturalWidth, image.naturalHeight, step.maxDimension);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: type !== "image/jpeg" });
      if (!context) throw new Error("The browser could not prepare the image canvas.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      if (type === "image/jpeg") {
        context.fillStyle = "#050706";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(image, 0, 0, width, height);

      const dataUrl = canvas.toDataURL(type, step.quality);
      if (!smallest || dataUrl.length < smallest.length) smallest = dataUrl;
      if (dataUrl.length <= estimateDataUrlLength(TARGET_COMPRESSED_ARTWORK_BYTES)) return dataUrl;
    }
  }

  if (smallest && smallest.length <= estimateDataUrlLength(MAX_COMPRESSED_ARTWORK_BYTES)) return smallest;

  throw new Error("This browser could not shrink the screenshot enough. Try a smaller image.");
}

/** Matches lib/server/chat-auth.ts's hashChatMessageContent (SHA-256 over the UTF-8 bytes, hex-encoded) so the client and server compute the identical hash. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signSupportChallenge(
  purpose: "support:ticket-create" | "support:ticket-reply" | "support:ticket-close",
  payload: Record<string, string>,
) {
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

  const [attachmentDataUrl, setAttachmentDataUrl] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const historyRef = useRef<HTMLElement | null>(null);

  const loadTickets = useCallback(async (wallet: string) => {
    try {
      const response = await fetch(`/api/support/tickets?walletAddress=${encodeURIComponent(wallet)}`, { cache: "no-store" });
      const payload = await readJsonResponse<{ tickets: SupportTicket[] }>(response, "Your tickets could not be loaded.");
      setTickets(payload.tickets);
      setTicketsError(null);
      // Any load that actually reaches the screen counts as "seen" (issue
      // #403) — including the background refreshes below — so the nav's red
      // dot clears the moment this page has current data on screen, not just
      // on the very first load.
      writeSupportLastSeen(wallet, Date.now());
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

  // Live refresh while this page is open (issue #403) — the one deliberate
  // exception to the app's no-polling rule, since this is the one screen a
  // user is actively awaiting a reply on. A refetch is silent: loadTickets
  // only ever updates `tickets` in place (never resets it to null), so
  // there's no loading-state flash and no scroll jump. The 60s timer only
  // ever runs while the tab is visible, and is torn down the moment it isn't
  // — see the SUPPORT_READ_LIMIT math in lib/server/api-protection.ts.
  useEffect(() => {
    if (!walletAddress) return;
    const wallet = walletAddress;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    function stopTimer() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function startTimer() {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void loadTickets(wallet);
      }, 60_000);
    }

    function handleBecameVisible() {
      if (document.visibilityState !== "visible") {
        stopTimer();
        return;
      }
      void loadTickets(wallet);
      startTimer();
    }

    if (document.visibilityState === "visible") startTimer();
    document.addEventListener("visibilitychange", handleBecameVisible);
    window.addEventListener("focus", handleBecameVisible);

    return () => {
      stopTimer();
      document.removeEventListener("visibilitychange", handleBecameVisible);
      window.removeEventListener("focus", handleBecameVisible);
    };
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

  async function handleScreenshotChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAttachmentError(null);
    if (!ALLOWED_SCREENSHOT_TYPES.has(file.type)) {
      setAttachmentError("That file type isn't supported. Choose a PNG, JPG or WEBP image.");
      return;
    }
    if (file.size > MAX_ARTWORK_SOURCE_BYTES) {
      setAttachmentError(`That file is ${formatMegabytes(file.size)}. Choose an image below ${formatMegabytes(MAX_ARTWORK_SOURCE_BYTES)}.`);
      return;
    }

    setAttachmentBusy(true);
    try {
      const dataUrl = file.size <= MAX_COMPRESSED_ARTWORK_BYTES ? await readFileAsDataUrl(file) : await optimiseScreenshotToDataUrl(file);
      setAttachmentDataUrl(dataUrl);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "The screenshot could not be attached.");
    } finally {
      setAttachmentBusy(false);
    }
  }

  function removeAttachment() {
    setAttachmentDataUrl(null);
    setAttachmentError(null);
  }

  async function handleSubmit() {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitted(false);
    try {
      // The image hash binds the screenshot to this exact signature (issue
      // #398) — an empty string when there's no attachment, otherwise the
      // SHA-256 of the exact data URL that will be sent below. The server
      // recomputes this same hash from its own validated bytes rather than
      // trusting a client-declared value, so a request can't be replayed
      // against a swapped image.
      const imageHash = attachmentDataUrl ? await sha256Hex(attachmentDataUrl) : "";
      const auth = await signSupportChallenge("support:ticket-create", {
        category,
        subject: trimmedSubject,
        body: trimmedBody,
        imageHash,
      });
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject: trimmedSubject,
          body: trimmedBody,
          attachmentDataUrl,
          challengeId: auth.challengeId,
          nonce: auth.nonce,
          signature: auth.signature,
        }),
      });
      await readJsonResponse<{ ticket: SupportTicket }>(response, "Your report could not be submitted.");
      setSubject("");
      setBody("");
      setAttachmentDataUrl(null);
      setSubmitted(true);
      await loadTickets(auth.account);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Your report could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  // Dismisses the post-submit success state (issue #401) — resets the form
  // to a fresh, empty New report and scrolls to the reports list below,
  // where the just-created ticket now shows.
  function handleDone() {
    setSubmitted(false);
    setSubmitError(null);
    setCategory("other");
    setSubject("");
    setBody("");
    setAttachmentDataUrl(null);
    setAttachmentError(null);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleClose(ticketId: string) {
    if (closingId) return;
    setClosingId(ticketId);
    setCloseError(null);
    try {
      const auth = await signSupportChallenge("support:ticket-close", { ticketId });
      const response = await fetch(`/api/support/tickets/${encodeURIComponent(ticketId)}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: auth.challengeId, nonce: auth.nonce, signature: auth.signature }),
      });
      await readJsonResponse<{ ticket: SupportTicket }>(response, "Your report could not be closed.");
      setCloseConfirmId(null);
      await loadTickets(auth.account);
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "Your report could not be closed.");
    } finally {
      setClosingId(null);
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

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Add a screenshot (optional)</span>
              {attachmentDataUrl ? (
                <div className={styles.attachmentPreview}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={styles.attachmentThumb} src={attachmentDataUrl} alt="Screenshot preview" />
                  <button
                    type="button"
                    className={styles.attachmentRemove}
                    disabled={submitting}
                    onClick={removeAttachment}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className={styles.srOnly}
                    disabled={submitting || attachmentBusy}
                    onChange={(event) => void handleScreenshotChange(event)}
                  />
                  <button
                    type="button"
                    className={styles.attachmentButton}
                    disabled={submitting || attachmentBusy}
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    {attachmentBusy ? "Optimising…" : "Choose screenshot"}
                  </button>
                </>
              )}
              {attachmentError ? (
                <p className={styles.errorBanner} role="alert">
                  {attachmentError}
                </p>
              ) : null}
            </div>

            {submitError ? (
              <p className={styles.errorBanner} role="alert">
                {submitError}
              </p>
            ) : null}
            {submitted ? (
              <div className={styles.successBanner} role="status">
                <p className={styles.successText}>
                  Report sent. We&apos;ll reply here. A red dot will appear on the Support tab when there&apos;s
                  news — you don&apos;t need to keep this page open.
                </p>
                <button type="button" className={styles.doneButton} onClick={handleDone}>
                  Done
                </button>
              </div>
            ) : null}

            <button
              type="button"
              className={styles.submitButton}
              disabled={submitting || attachmentBusy || !subject.trim() || !body.trim()}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Sending…" : "Send report"}
            </button>
          </section>
        )}

        {walletAddress ? (
          <section ref={historyRef} className={styles.panel} aria-labelledby="support-history-title">
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
                        {ticket.attachmentDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={styles.attachmentThumb} src={ticket.attachmentDataUrl} alt="Screenshot you attached" />
                        ) : null}
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

                        {REPLYABLE_STATUSES.has(ticket.status) ? (
                          <div className={styles.closeRow}>
                            {closeConfirmId === ticket.id ? (
                              <>
                                <p className={styles.closeConfirmText}>
                                  Close this report? You can&apos;t reopen it — file a new report if the problem comes
                                  back.
                                </p>
                                <div className={styles.closeConfirmActions}>
                                  <button
                                    type="button"
                                    className={styles.closeConfirmButton}
                                    disabled={closingId === ticket.id}
                                    onClick={() => void handleClose(ticket.id)}
                                  >
                                    {closingId === ticket.id ? "Closing…" : "Confirm close"}
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.closeCancelButton}
                                    disabled={closingId === ticket.id}
                                    onClick={() => setCloseConfirmId(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <button
                                type="button"
                                className={styles.closeRequestButton}
                                onClick={() => {
                                  setCloseError(null);
                                  setCloseConfirmId(ticket.id);
                                }}
                              >
                                Close this report
                              </button>
                            )}
                            {closeError && closeConfirmId === ticket.id ? (
                              <p className={styles.errorBanner} role="alert">
                                {closeError}
                              </p>
                            ) : null}
                          </div>
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
