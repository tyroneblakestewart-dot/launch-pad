/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom } from "viem";
import { HOODCHAT_CATEGORY_LABELS, type HoodchatCategory } from "@/lib/hoodchat-categories";
import { shortenAddress } from "@/lib/token-page-format";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import styles from "./hoodchat-hub.module.css";

type HoodchatMessage = {
  id: string;
  walletAddress: string;
  category: HoodchatCategory;
  body: string;
  createdAt: string;
  reportCount: number;
  hidden: boolean;
};

type FilterTab = HoodchatCategory | "all";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new-launches", label: HOODCHAT_CATEGORY_LABELS["new-launches"] },
  { id: "trading", label: HOODCHAT_CATEGORY_LABELS.trading },
  { id: "projects", label: HOODCHAT_CATEGORY_LABELS.projects },
  { id: "general", label: HOODCHAT_CATEGORY_LABELS.general },
];

const POLL_INTERVAL_MS = 5000;
const POST_CATEGORY: HoodchatCategory = "general";

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<T>;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

async function postMessage(category: HoodchatCategory, body: string): Promise<HoodchatMessage> {
  const provider = getInjectedEvmProvider();
  if (!provider) throw new Error("Connect an EVM wallet before posting.");
  const walletClient = createWalletClient({ transport: custom(provider) });
  const [account] = await walletClient.getAddresses();
  if (!account) throw new Error("Connect an EVM wallet before posting.");
  const walletChainId = await walletClient.getChainId();

  const challengeResponse = await fetch("/api/hoodchat/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: account, walletChainId, category, body }),
  });
  const challenge = await readJsonResponse<{ challengeId: string; nonce: string; message: string }>(
    challengeResponse,
    "Could not start posting.",
  );
  const signature = await walletClient.signMessage({ account, message: challenge.message });

  const postResponse = await fetch("/api/hoodchat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.challengeId, nonce: challenge.nonce, signature, category, body }),
  });
  const posted = await readJsonResponse<{ message: HoodchatMessage }>(postResponse, "The message could not be posted.");
  return posted.message;
}

export type HoodchatHubProps = {
  heroIntro: string;
  emptyState: string;
  composerPlaceholder: string;
  connectPrompt: string;
};

export function HoodchatHub({
  heroIntro,
  emptyState,
  composerPlaceholder,
  connectPrompt,
}: HoodchatHubProps) {
  const [filter, setFilter] = useState<FilterTab>("all");
  const [messages, setMessages] = useState<HoodchatMessage[]>([]);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const provider = getInjectedEvmProvider();
    if (!provider) return;
    provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (!cancelled && Array.isArray(accounts) && accounts[0]) setWalletAddress(accounts[0] as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const url = filter === "all" ? "/api/hoodchat/messages" : `/api/hoodchat/messages?category=${filter}`;
        const response = await fetch(url, { cache: "no-store" });
        const payload = await readJsonResponse<{ messages: HoodchatMessage[] }>(response, "The feed could not be loaded.");
        if (!cancelled) setMessages(payload.messages);
      } catch {
        // A failed poll leaves the previously loaded feed in place.
      }
    }

    void load();
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [filter]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const connectWallet = useCallback(async () => {
    const provider = getInjectedEvmProvider();
    if (!provider) {
      setError("No EVM wallet was found in this browser.");
      return;
    }
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts?.[0]) setWalletAddress(accounts[0]);
    } catch {
      setError("Wallet connection was cancelled.");
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    try {
      const message = await postMessage(POST_CATEGORY, body);
      setMessages((current) => [...current, message]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The message could not be posted.");
    } finally {
      setPosting(false);
    }
  }, [draft, posting]);

  const handleReport = useCallback(async (id: string) => {
    setReportedIds((current) => new Set(current).add(id));
    try {
      const response = await fetch("/api/hoodchat/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id }),
      });
      const result = await readJsonResponse<{ hidden: boolean }>(response, "The report could not be recorded.");
      if (result.hidden) setMessages((current) => current.filter((item) => item.id !== id));
    } catch {
      // Reporting is best-effort from the visitor's point of view.
    }
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <img src="/hoodchat-wordmark.png" alt="Hoodchat" className={styles.wordmark} width={1519} height={512} />
          <p className={styles.intro}>{heroIntro}</p>
        </header>

        <div className={styles.panel}>
          <div className={styles.filterTabs} role="tablist" aria-label="Filter by category">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                className={`${styles.filterTab} ${filter === tab.id ? styles.filterTabActive : ""}`}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles.feed}>
            {messages.length === 0 ? (
              <p className={styles.emptyState}>{emptyState}</p>
            ) : (
              messages.map((item) => (
                <article key={item.id} className={styles.message}>
                  <div className={styles.messageMeta}>
                    <span className={styles.messageWallet}>{shortenAddress(item.walletAddress)}</span>
                    <span className={styles.messageCategory}>{HOODCHAT_CATEGORY_LABELS[item.category]}</span>
                    <span className={styles.messageTime}>{formatTimestamp(item.createdAt)}</span>
                  </div>
                  <p className={styles.messageBody}>{item.body}</p>
                  <button
                    type="button"
                    className={styles.reportButton}
                    disabled={reportedIds.has(item.id)}
                    onClick={() => void handleReport(item.id)}
                  >
                    {reportedIds.has(item.id) ? "Reported" : "Report"}
                  </button>
                </article>
              ))
            )}
            <div ref={feedEndRef} />
          </div>
        </div>

        {error ? <p className={styles.errorBanner} role="alert">{error}</p> : null}

        <div className={styles.composer}>
          {walletAddress ? (
            <>
              <input
                className={styles.composerInput}
                type="text"
                value={draft}
                maxLength={280}
                placeholder={composerPlaceholder}
                disabled={posting}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleSubmit();
                }}
              />
              <button
                type="button"
                className={styles.composerSend}
                disabled={posting || !draft.trim()}
                onClick={() => void handleSubmit()}
              >
                {posting ? "Sending…" : "Send"}
              </button>
            </>
          ) : (
            <button type="button" className={styles.composerConnect} onClick={() => void connectWallet()}>
              {connectPrompt}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
