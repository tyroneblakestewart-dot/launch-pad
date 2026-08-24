import { hashChatMessageContent, hashChatNonce, tryConsumeChatChallenge, verifyChatSignature } from "@/lib/server/chat-auth";

// Wallet-signed auth for recording a token launch (Milestone A, issue #409
// Part 2) — reuses lib/server/chat-auth.ts's generic challenge/signature
// primitives exactly the way lib/server/support-ticket-auth.ts does, rather
// than inventing a second auth scheme. In-memory (not the durable
// wallet_nonces table lib/server/publish-auth.ts uses for site publishing):
// unlike publishing, a launch record is never trusted on the strength of
// this signature alone — lib/server/token-launch-reconciliation.ts always
// re-derives the same facts from a live on-chain read before any row is
// inserted, so a forged or replayed signature still cannot create a false
// record. The signature's job here is establishing which wallet is asking,
// not proving the launch happened.

export const TOKEN_LAUNCH_ACTION_PURPOSES = ["token-launch:record"] as const;

export type TokenLaunchActionPurpose = (typeof TOKEN_LAUNCH_ACTION_PURPOSES)[number];

export function isTokenLaunchActionPurpose(value: unknown): value is TokenLaunchActionPurpose {
  return typeof value === "string" && (TOKEN_LAUNCH_ACTION_PURPOSES as readonly string[]).includes(value);
}

/** Deterministically hashes a flat string-valued payload so both challenge issuance and action consumption compute the same value regardless of key order. */
export function hashTokenLaunchAction(purpose: TokenLaunchActionPurpose, payload: Record<string, string>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("&");
  return hashChatMessageContent(`${purpose}:${canonical}`);
}

export type AuthoriseTokenLaunchActionInput = {
  purpose: TokenLaunchActionPurpose;
  payload: Record<string, string>;
  challengeId: string;
  nonce: string;
  signature: string;
};

export type AuthoriseTokenLaunchActionResult =
  | { status: "ok"; walletAddress: string }
  | { status: "invalid_challenge" }
  | { status: "expired" }
  | { status: "replayed" }
  | { status: "invalid_signature" };

/** Consumes a challenge issued by POST /api/token-launches/challenge and verifies the wallet's signature over it, bound to this exact purpose+payload. */
export async function authoriseTokenLaunchAction(
  input: AuthoriseTokenLaunchActionInput,
): Promise<AuthoriseTokenLaunchActionResult> {
  const contentHash = hashTokenLaunchAction(input.purpose, input.payload);
  const consumed = tryConsumeChatChallenge(input.challengeId, hashChatNonce(input.nonce), contentHash);
  if (consumed.status === "nonce_expired") return { status: "expired" };
  if (consumed.status === "nonce_replayed") return { status: "replayed" };
  if (consumed.status !== "ok") return { status: "invalid_challenge" };
  if (consumed.challenge.purpose !== input.purpose) return { status: "invalid_challenge" };

  const validSignature = await verifyChatSignature(consumed.challenge, input.nonce, input.signature);
  if (!validSignature) return { status: "invalid_signature" };

  return { status: "ok", walletAddress: consumed.challenge.walletAddress };
}
