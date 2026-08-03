import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress, verifyMessage } from "viem";

// Shared wallet-signed posting auth for both Hoodchat features (issue #237):
// the main /hoodchat feed and the per-token chat tab. Modelled on
// lib/server/publish-auth.ts's SIWE-style challenge/signature flow, but
// challenges are held in memory (see below) rather than in a durable table —
// a chat post isn't an irreversible/valuable action like publishing a site,
// so a per-instance, short-lived (5 minute) nonce is an adequate, much
// simpler replay guard here.
export const CHAT_NONCE_TTL_MS = 5 * 60 * 1000;
export const CHAT_DOMAIN = "hoodlums.dev";

export type ChatChallenge = {
  id: string;
  nonceHash: string;
  walletAddress: string;
  walletChainId: number;
  purpose: string;
  contentHash: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

export type ChatChallengeMessageInput = Pick<
  ChatChallenge,
  "id" | "walletAddress" | "walletChainId" | "purpose" | "contentHash" | "issuedAt" | "expiresAt"
> & {
  nonce: string;
};

export function normaliseChatWalletAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value.trim());
  } catch {
    return null;
  }
}

export function normaliseChatWalletChainId(value: unknown): number | null {
  const chainId = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(chainId) && chainId > 0 && chainId <= 2_147_483_647
    ? chainId
    : null;
}

export function createChatNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function hashChatNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

/** Binds a challenge to exact message content so it can't be reused for different text after signing. */
export function hashChatMessageContent(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildChatAuthorisationMessage(input: ChatChallengeMessageInput): string {
  return `${CHAT_DOMAIN} wants you to authorize posting a message with your Ethereum account:
${input.walletAddress}

This is a message signature only; it does not send a transaction or spend gas.

Version: 1
Chain ID: ${input.walletChainId}
Nonce: ${input.nonce}
Issued At: ${input.issuedAt.toISOString()}
Expiration Time: ${input.expiresAt.toISOString()}
Request ID: ${input.id}
Purpose: ${input.purpose}
Message Content Hash: ${input.contentHash}`;
}

export async function verifyChatSignature(
  challenge: ChatChallenge,
  nonce: string,
  signature: unknown,
): Promise<boolean> {
  if (hashChatNonce(nonce) !== challenge.nonceHash) return false;
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) return false;

  const message = buildChatAuthorisationMessage({ ...challenge, nonce });

  try {
    return await verifyMessage({
      address: challenge.walletAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory challenge registry
// ---------------------------------------------------------------------------

type ChallengeRegistry = Map<string, ChatChallenge>;

type GlobalWithChatChallenges = typeof globalThis & {
  __hoodlumsChatChallenges?: ChallengeRegistry;
};

function challengeRegistry(): ChallengeRegistry {
  const globalScope = globalThis as GlobalWithChatChallenges;
  if (!globalScope.__hoodlumsChatChallenges) {
    globalScope.__hoodlumsChatChallenges = new Map();
  }
  return globalScope.__hoodlumsChatChallenges;
}

export function createChatChallenge(input: Omit<ChatChallenge, "id" | "usedAt">): ChatChallenge {
  const challenge: ChatChallenge = { ...input, id: randomUUID(), usedAt: null };
  challengeRegistry().set(challenge.id, challenge);
  return challenge;
}

export type ChatChallengeConsumeResult =
  | { status: "ok"; challenge: ChatChallenge }
  | { status: "nonce_not_found" }
  | { status: "nonce_replayed" }
  | { status: "nonce_expired" }
  | { status: "nonce_mismatch" };

/**
 * Looks up a challenge and marks it used in one synchronous step (no `await`
 * in between), so two concurrent requests for the same challenge can't both
 * observe it as unused. The nonce is burned here regardless of whether the
 * signature check that follows ultimately succeeds — a failed attempt just
 * means the caller requests a fresh (free) challenge.
 */
export function tryConsumeChatChallenge(
  id: string,
  nonceHash: string,
  contentHash: string,
  now = new Date(),
): ChatChallengeConsumeResult {
  const challenge = challengeRegistry().get(id);
  if (!challenge) return { status: "nonce_not_found" };
  if (challenge.usedAt) return { status: "nonce_replayed" };
  if (challenge.expiresAt.getTime() <= now.getTime()) return { status: "nonce_expired" };
  if (challenge.nonceHash !== nonceHash || challenge.contentHash !== contentHash) {
    return { status: "nonce_mismatch" };
  }
  challenge.usedAt = now;
  return { status: "ok", challenge };
}

export function resetChatChallengesForTests(): void {
  challengeRegistry().clear();
}
