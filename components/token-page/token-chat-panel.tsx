"use client";

import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom } from "viem";
import { shortenAddress } from "@/lib/token-page-format";
import { getInjectedEvmProvider } from "@/lib/wallet-provider";
import type { TokenHolder } from "@/lib/server/token-holders";
import type { SupportedChain } from "@/lib/types";
import styles from "./token-page.module.css";

type TokenChatMessage = {
  id: string;
  walletAddress: string;
  body: string;
  createdAt: string;
  reportCount: number;
  hidden: boolean;
};

const POLL_INTERVAL_MS = 5000;

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

export type TokenChatPanelProps = {
  chain: SupportedChain;
  address: string;
  symbol: string | null;
  holders: TokenHolder[];
  emptyState?: string;
  connectPrompt?: string;
};

export function TokenChatPanel({
  chain,
  address,
  symbol,
  holders,
  emptyState = "No messages yet. Be the first to post.",
  connectPrompt = "Connect wallet to post",
}: TokenChatPanelProps) {
  const [messages, setMessages] = useState<TokenChatMessage[]>([]);
  const [creatorWalletAddress, setCreatorWalletAddress] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

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
        const response = await fetch(
          `/api/token-chat/messages?chain=${chain}&contractAddress=${encodeURIComponent(address)}`,
          { cache: "no-store" },
        );
        const payload = await readJsonResponse<{ messages: TokenChatMessage[]; creatorWalletAddress: string | null }>(
          response,
          "The chat could not be loaded.",
        );
        if (!cancelled) {
          setMessages(payload.messages);
          setCreatorWalletAddress(payload.creatorWalletAddress);
        }
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
  }, [chain, address]);

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
    const provider = getInjectedEvmProvider();
    if (!provider) {
      setError("Connect an EVM wallet before posting.");
      return;
    }
    setPosting(true);
    setError(null);
    try {
      const walletClient = createWalletClient({ transport: custom(provider) });
      const [account] = await walletClient.getAddresses();
      if (!account) throw new Error("Connect an EVM wallet before posting.");
      const walletChainId = await walletClient.getChainId();

      const challengeResponse = await fetch("/api/token-chat/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: account, walletChainId, chain, contractAddress: address, body }),
      });
      const challenge = await readJsonResponse<{ challengeId: string; nonce: string; message: string }>(
        challengeResponse,
        "Could not start posting.",
      );
      const signature = await walletClient.signMessage({ account, message: challenge.message });

      const postResponse = await fetch("/api/token-chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          signature,
          chain,
          contractAddress: address,
          body,
        }),
      });
      const posted = await readJsonResponse<{ message: TokenChatMessage }>(postResponse, "The message could not be posted.");
      setMessages((current) => [...current, posted.message]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The message could not be posted.");
    } finally {
      setPosting(false);
    }
  }, [address, chain, draft, posting]);

  const handleReport = useCallback(async (id: string) => {
    setReportedIds((current) => new Set(current).add(id));
    try {
      const response = await fetch("/api/token-chat/report", {
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

  const isHolder = (wallet: string) => holders.some((holder) => holder.address.toLowerCase() === wallet.toLowerCase());
  const isCreator = (wallet: string) => Boolean(creatorWalletAddress) && creatorWalletAddress!.toLowerCase() === wallet.toLowerCase();

  return (
    <div className={styles.chatFeedShell}>
      <div className={styles.chatFeed}>
        {messages.length === 0 ? (
          <p className={styles.emptyState}>{emptyState}</p>
        ) : (
          messages.map((item) => (
            <article key={item.id} className={styles.chatMessage}>
              <div className={styles.chatMeta}>
                <span className={styles.chatWallet}>{shortenAddress(item.walletAddress)}</span>
                {isCreator(item.walletAddress) ? <span className={styles.chatBadgeDev}>Dev</span> : null}
                {isHolder(item.walletAddress) ? <span className={styles.chatBadgeHolder}>Holder</span> : null}
                <span className={styles.chatTime}>{formatTimestamp(item.createdAt)}</span>
              </div>
              <p className={styles.chatBody}>{item.body}</p>
              <button
                type="button"
                className={styles.chatReport}
                disabled={reportedIds.has(item.id)}
                onClick={() => void handleReport(item.id)}
              >
                {reportedIds.has(item.id) ? "Reported" : "Report"}
              </button>
            </article>
          ))
        )}
      </div>

      {error ? <p className={styles.chatError}>{error}</p> : null}

      <div className={styles.chatComposer}>
        {walletAddress ? (
          <>
            <input
              className={styles.chatComposerInput}
              type="text"
              value={draft}
              maxLength={280}
              placeholder={`Chat about ${symbol ? `$${symbol}` : "this token"}…`}
              disabled={posting}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSubmit();
              }}
            />
            <button
              type="button"
              className={styles.chatComposerSend}
              disabled={posting || !draft.trim()}
              onClick={() => void handleSubmit()}
            >
              {posting ? "…" : "Send"}
            </button>
          </>
        ) : (
          <button type="button" className={styles.chatComposerConnect} onClick={() => void connectWallet()}>
            {connectPrompt}
          </button>
        )}
      </div>
    </div>
  );
}
