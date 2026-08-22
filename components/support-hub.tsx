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
import { copyToClipboard } from "@/lib/clipboard";
import { markSupportUnreadSeen } from "@/lib/use-support-unread";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./support-hub.module.css";

// The extension calls this with whatever it wants — `accounts` is untrusted
// wallet-extension input, not necessarily a string[] (issue #405 crash
// audit), so the handler itself narrows before use rather than trusting
// this type.
type AccountsChangedHandler = (accounts: unknown) => void;

// getInjectedEvmProvider()'s shared Eip1193Provider type only declares
// `request` — widen locally for the accountsChanged listener, matching
// components/account-wallet-bridge.tsx's own local extension.
type WalletProviderWithEvents = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: "accountsChanged", handler: AccountsChangedHandler) => void;
  removeListener?: (event: "accountsChanged", handler: AccountsChangedHandler) => void;
};

/**
 * Calls a browser/extension API that isn't itself a user-visible action
 * (event (un)registration, best-effort cleanup, scroll-into-view) and
 * swallows a synchronous throw rather than let it become an uncaught
 * exception (issue #405 crash audit — extension-injected methods like
 * `provider.on`/`removeListener` are not guaranteed not to throw). Never
 * used for calls whose failure should be shown to the user.
 */
function safeInvoke(fn: () => void): void {
  try {
    fn();
  } catch {
    // Best-effort — see the doc comment above.
  }
}

/** Narrows an untrusted accountsChanged payload to a single string address, or undefined for anything else (issue #405 crash audit). */
function firstStringAccount(accounts: unknown): string | undefined {
  if (!Array.isArray(accounts)) return undefined;
  const first = accounts[0];
  return typeof first === "string" && first ? first : undefined;
}

/**
 * `provider.request` is extension-injected code — it isn't guaranteed to
 * return a Promise, and it isn't guaranteed not to throw synchronously
 * before it gets the chance to (issue #405 review). Calling it directly
 * inside a `.then()`/`.catch()` chain only protects the async rejection
 * path; a synchronous throw would still become an uncaught exception. This
 * wraps the call itself and normalises whatever comes back — a thrown
 * error, a non-Promise value, or a well-behaved Promise — through
 * `Promise.resolve` so callers can always safely `.then()`/`.catch()` it.
 */
function safeProviderRequest(
  provider: WalletProviderWithEvents,
  args: { method: string; params?: unknown[] | Record<string, unknown> },
): Promise<unknown> {
  try {
    return Promise.resolve(provider.request(args));
  } catch {
    return Promise.resolve(undefined);
  }
}

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

/** The bounded, status-only shape GET /api/support/tickets/reference returns (issue #405) — never body/subject/attachment/diagnostics/messages/wallet. */
type AnonymousSupportTicketStatus = {
  referenceCode: string;
  status: SupportTicketStatus;
  category: SupportTicketCategory;
  createdAt: string;
  updatedAt: string;
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

// image.onload/onerror and reader.onload/onerror below run as separate
// event dispatches, not inside this Promise executor's synchronous
// execution — a throw inside one of them would NOT auto-reject the promise
// the way a throw during the executor itself does, so it would surface as
// an uncaught exception instead. Every callback body below is wrapped
// accordingly (issue #405 crash audit).
const SCREENSHOT_OPEN_ERROR = "This image could not be opened by the browser. Try a PNG, JPG or WEBP screenshot.";

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let objectUrl: string;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      reject(new Error(SCREENSHOT_OPEN_ERROR));
      return;
    }
    let image: HTMLImageElement;
    try {
      image = new Image();
    } catch {
      safeInvoke(() => URL.revokeObjectURL(objectUrl));
      reject(new Error(SCREENSHOT_OPEN_ERROR));
      return;
    }
    image.onload = () => {
      safeInvoke(() => URL.revokeObjectURL(objectUrl));
      try {
        resolve(image);
      } catch {
        reject(new Error(SCREENSHOT_OPEN_ERROR));
      }
    };
    image.onerror = () => {
      safeInvoke(() => URL.revokeObjectURL(objectUrl));
      reject(new Error(SCREENSHOT_OPEN_ERROR));
    };
    try {
      image.src = objectUrl;
    } catch {
      safeInvoke(() => URL.revokeObjectURL(objectUrl));
      reject(new Error(SCREENSHOT_OPEN_ERROR));
    }
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    let reader: FileReader;
    try {
      reader = new FileReader();
    } catch {
      reject(new Error("The file could not be read."));
      return;
    }
    reader.onload = () => {
      try {
        resolve(String(reader.result || ""));
      } catch {
        reject(new Error("The file could not be read."));
      }
    };
    reader.onerror = () => {
      try {
        reject(reader.error ?? new Error("The file could not be read."));
      } catch {
        reject(new Error("The file could not be read."));
      }
    };
    try {
      reader.readAsDataURL(file);
    } catch {
      reject(new Error("The file could not be read."));
    }
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
      let dataUrl: string;
      try {
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
        dataUrl = canvas.toDataURL(type, step.quality);
      } catch {
        // Contained per-step — a canvas failure at one size/type
        // combination tries the next step instead of aborting the whole
        // optimisation pass (issue #405 crash audit).
        continue;
      }
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

  // Anonymous/no-wallet reporting (issue #405) — a fallback for a reporter
  // whose wallet won't connect. The reference code is shown exactly once on
  // success and deliberately never written to localStorage/sessionStorage.
  const [anonymousReferenceCode, setAnonymousReferenceCode] = useState<string | null>(null);
  const [referenceCodeCopied, setReferenceCodeCopied] = useState(false);

  const [referenceCodeQuery, setReferenceCodeQuery] = useState("");
  const [referenceLookupResult, setReferenceLookupResult] = useState<AnonymousSupportTicketStatus | null>(null);
  const [referenceLookupError, setReferenceLookupError] = useState<string | null>(null);
  const [referenceLookupBusy, setReferenceLookupBusy] = useState(false);

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
      // on the very first load. markSupportUnreadSeen (issue #405) uses the
      // newest *observed* ticket activity timestamp rather than wall-clock
      // write time, and notifies the shared nav cache immediately so an
      // already-lit dot clears without waiting for another focus/refresh.
      markSupportUnreadSeen(wallet, payload.tickets);
    } catch (error) {
      setTicketsError(error instanceof Error ? error.message : "Your tickets could not be loaded.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const provider = getInjectedEvmProvider() as WalletProviderWithEvents | undefined;
    if (!provider) return;
    safeProviderRequest(provider, { method: "eth_accounts" })
      .then((accounts) => {
        const first = firstStringAccount(accounts);
        if (!cancelled && first) setWalletAddress(first);
      })
      .catch(() => {});

    // Keep the displayed ticket history following whichever wallet/account is
    // actually active — a switch or disconnect in the extension must clear
    // stale tickets immediately rather than keep showing the previous
    // wallet's history (issue #393 review). `accounts` is untrusted
    // extension input — firstStringAccount narrows it rather than trusting
    // Array.isArray alone, since a non-string first element (object, symbol)
    // would otherwise flow into walletAddress and later explode during
    // encoding/rendering (issue #405 crash audit).
    const handleAccountsChanged: AccountsChangedHandler = (accounts) => {
      if (cancelled) return;
      const nextAccount = firstStringAccount(accounts);
      setWalletAddress(nextAccount || null);
    };
    safeInvoke(() => provider.on?.("accountsChanged", handleAccountsChanged));

    return () => {
      cancelled = true;
      safeInvoke(() => provider.removeListener?.("accountsChanged", handleAccountsChanged));
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

    // Every browser-API call below is wrapped — a hostile/broken
    // environment (or an extension patching these globals) must not turn
    // listener setup, a timer tick, or cleanup into an uncaught exception
    // (issue #405 crash audit).
    function stopTimer() {
      if (intervalId !== null) {
        const id = intervalId;
        intervalId = null;
        safeInvoke(() => clearInterval(id));
      }
    }

    function startTimer() {
      if (intervalId !== null) return;
      try {
        intervalId = setInterval(() => {
          void loadTickets(wallet);
        }, 60_000);
      } catch {
        intervalId = null;
      }
    }

    function isPageVisible(): boolean {
      try {
        return document.visibilityState === "visible";
      } catch {
        return true;
      }
    }

    function handleBecameVisible() {
      if (!isPageVisible()) {
        stopTimer();
        return;
      }
      void loadTickets(wallet);
      startTimer();
    }

    if (isPageVisible()) startTimer();
    safeInvoke(() => document.addEventListener("visibilitychange", handleBecameVisible));
    safeInvoke(() => window.addEventListener("focus", handleBecameVisible));

    return () => {
      stopTimer();
      safeInvoke(() => document.removeEventListener("visibilitychange", handleBecameVisible));
      safeInvoke(() => window.removeEventListener("focus", handleBecameVisible));
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
    safeInvoke(() => {
      event.target.value = "";
    });
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

  async function handleSignedSubmit() {
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

  // Anonymous fallback (issue #405) for a reporter whose wallet won't
  // connect — no challenge, no signature. The server generates and returns
  // a one-time reference code; this report gets no reply thread.
  async function handleAnonymousSubmit() {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (!trimmedSubject || !trimmedBody || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    setAnonymousReferenceCode(null);
    setReferenceCodeCopied(false);
    try {
      const response = await fetch("/api/support/tickets/anonymous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject: trimmedSubject, body: trimmedBody, attachmentDataUrl }),
      });
      const payload = await readJsonResponse<{ ticket: { referenceCode: string } }>(response, "Your report could not be submitted.");
      setSubject("");
      setBody("");
      setAttachmentDataUrl(null);
      setAnonymousReferenceCode(payload.ticket.referenceCode);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Your report could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit() {
    return walletAddress ? handleSignedSubmit() : handleAnonymousSubmit();
  }

  // Dismisses the anonymous success state (issue #405) — there is no ticket
  // history to scroll to without a wallet, so this is deliberately simpler
  // than handleDone below.
  function handleAnonymousDone() {
    setAnonymousReferenceCode(null);
    setReferenceCodeCopied(false);
    setSubmitError(null);
    setCategory("other");
    setSubject("");
    setBody("");
    setAttachmentDataUrl(null);
    setAttachmentError(null);
  }

  async function handleCopyReferenceCode() {
    if (!anonymousReferenceCode) return;
    const copied = await copyToClipboard(anonymousReferenceCode);
    setReferenceCodeCopied(copied);
  }

  async function handleReferenceLookup() {
    const code = referenceCodeQuery.trim();
    if (!code || referenceLookupBusy) return;
    setReferenceLookupBusy(true);
    setReferenceLookupError(null);
    setReferenceLookupResult(null);
    try {
      const response = await fetch(`/api/support/tickets/reference?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      const payload = await readJsonResponse<{ status: AnonymousSupportTicketStatus }>(
        response,
        "No report was found for that reference code.",
      );
      setReferenceLookupResult(payload.status);
    } catch (error) {
      setReferenceLookupError(error instanceof Error ? error.message : "No report was found for that reference code.");
    } finally {
      setReferenceLookupBusy(false);
    }
  }

  // Dismisses the post-submit success state (issue #401) — resets the form
  // to a fresh, empty New report and scrolls to the reports list below,
  // where the just-created ticket now shows. Shared verbatim by both the
  // Done button and the success card's corner X (issue #405).
  function handleDone() {
    setSubmitted(false);
    setSubmitError(null);
    setCategory("other");
    setSubject("");
    setBody("");
    setAttachmentDataUrl(null);
    setAttachmentError(null);
    safeInvoke(() => historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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

        <section className={styles.panel} aria-labelledby="support-form-title">
            <h2 id="support-form-title" className={styles.panelTitle}>
              New report
            </h2>

            {!walletAddress ? (
              <div className={styles.anonymousNotice}>
                <p className={styles.anonymousNoticeText}>
                  Connect your wallet if you can — it lets us reply to you.
                </p>
                <button type="button" className={styles.connectButton} onClick={() => void connectWallet()}>
                  Connect wallet
                </button>
              </div>
            ) : null}

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
                    onClick={() => {
                      setAttachmentError(null);
                      try {
                        attachmentInputRef.current?.click();
                      } catch {
                        setAttachmentError("The file picker could not be opened. Try again.");
                      }
                    }}
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

            {!walletAddress && !anonymousReferenceCode ? (
              <p className={styles.anonymousWarning}>
                Reporting without a wallet means this report has no reply thread — we can&apos;t message you back
                here. You&apos;ll get a one-time reference code to check its status later. Save it; it can&apos;t be
                recovered from this browser afterward.
              </p>
            ) : null}

            {submitError ? (
              <p className={styles.errorBanner} role="alert">
                {submitError}
              </p>
            ) : null}
            {submitted ? (
              <div className={styles.successBanner} role="status">
                <button
                  type="button"
                  className={styles.successDismissX}
                  onClick={handleDone}
                  aria-label="Dismiss"
                >
                  ×
                </button>
                <p className={styles.successText}>
                  Report sent. We&apos;ll reply here. A red dot will appear on the Support tab when there&apos;s
                  news — you don&apos;t need to keep this page open.
                </p>
                <button type="button" className={styles.doneButton} onClick={handleDone}>
                  Done
                </button>
              </div>
            ) : null}
            {anonymousReferenceCode ? (
              <div className={styles.successBanner} role="status">
                <button
                  type="button"
                  className={styles.successDismissX}
                  onClick={handleAnonymousDone}
                  aria-label="Dismiss"
                >
                  ×
                </button>
                <div className={styles.referenceCodeBlock}>
                  <p className={styles.successText}>
                    Report sent anonymously. This report has no reply thread — save this reference code to check its
                    status later. It cannot be recovered from this browser.
                  </p>
                  <div className={styles.referenceCodeRow}>
                    <code className={styles.referenceCodeValue}>{anonymousReferenceCode}</code>
                    <button type="button" className={styles.copyButton} onClick={() => void handleCopyReferenceCode()}>
                      {referenceCodeCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                <button type="button" className={styles.doneButton} onClick={handleAnonymousDone}>
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

        <section className={styles.panel} aria-labelledby="support-reference-lookup-title">
          <h2 id="support-reference-lookup-title" className={styles.panelTitle}>
            Check a report by reference code
          </h2>
          <div className={styles.referenceLookupRow}>
            <input
              className={styles.input}
              type="text"
              value={referenceCodeQuery}
              placeholder="XXXX-XXXXXX"
              disabled={referenceLookupBusy}
              onChange={(event) => setReferenceCodeQuery(event.target.value)}
            />
            <button
              type="button"
              className={styles.referenceLookupButton}
              disabled={referenceLookupBusy || !referenceCodeQuery.trim()}
              onClick={() => void handleReferenceLookup()}
            >
              {referenceLookupBusy ? "Checking…" : "Check status"}
            </button>
          </div>
          {referenceLookupError ? (
            <p className={styles.errorBanner} role="alert">
              {referenceLookupError}
            </p>
          ) : null}
          {referenceLookupResult ? (
            <p className={styles.referenceLookupResult}>
              {STATUS_LABEL[referenceLookupResult.status]} · {referenceLookupResult.category} · reported{" "}
              {formatTimestamp(referenceLookupResult.createdAt)}
            </p>
          ) : null}
        </section>

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
                    {/* Collapse/expand only ever touches local UI state (expandedId) — it
                        never calls an API, unlike "Mark as resolved" below (issue #405). */}
                    <button
                      type="button"
                      className={styles.ticketSummary}
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : ticket.id)}
                    >
                      <span className={styles.ticketSubject}>{ticket.subject}</span>
                      <span className={styles.ticketStatus}>{STATUS_LABEL[ticket.status]}</span>
                      <span className={expanded ? styles.chevronExpanded : styles.chevron} aria-hidden="true">
                        ▾
                      </span>
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
                                  This closes the report. It does not just hide this box. You can&apos;t reopen it —
                                  file a new report if the problem comes back.
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
                                Mark as resolved — I&apos;m done with this
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
