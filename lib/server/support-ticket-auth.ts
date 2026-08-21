import { hashChatMessageContent, hashChatNonce, tryConsumeChatChallenge, verifyChatSignature } from "@/lib/server/chat-auth";

// Wallet-signed auth for support ticket creation and follow-up replies
// (issue #393) — reuses lib/server/chat-auth.ts's generic challenge/
// signature primitives exactly the way lib/server/social-studio-action-auth.ts
// does for Social Studio actions, rather than inventing a second auth
// scheme. Kept as its own purpose-scoped module (its own challenge route,
// its own "support" service-isolation key) instead of folding into
// social-studio-action-auth.ts, so isolating Social Studio posting can
// never accidentally block support ticket submission, and vice versa.

export const SUPPORT_ACTION_PURPOSES = ["support:ticket-create", "support:ticket-reply"] as const;

export type SupportActionPurpose = (typeof SUPPORT_ACTION_PURPOSES)[number];

export function isSupportActionPurpose(value: unknown): value is SupportActionPurpose {
  return typeof value === "string" && (SUPPORT_ACTION_PURPOSES as readonly string[]).includes(value);
}

/** Deterministically hashes a flat string-valued payload so both challenge issuance and action consumption compute the same value regardless of key order. */
export function hashSupportAction(purpose: SupportActionPurpose, payload: Record<string, string>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("&");
  return hashChatMessageContent(`${purpose}:${canonical}`);
}

export type AuthoriseSupportActionInput = {
  purpose: SupportActionPurpose;
  payload: Record<string, string>;
  challengeId: string;
  nonce: string;
  signature: string;
};

export type AuthoriseSupportActionResult =
  | { status: "ok"; walletAddress: string }
  | { status: "invalid_challenge" }
  | { status: "expired" }
  | { status: "replayed" }
  | { status: "invalid_signature" };

/** Consumes a challenge issued by POST /api/support/challenge and verifies the wallet's signature over it, bound to this exact purpose+payload. */
export async function authoriseSupportAction(input: AuthoriseSupportActionInput): Promise<AuthoriseSupportActionResult> {
  const contentHash = hashSupportAction(input.purpose, input.payload);
  const consumed = tryConsumeChatChallenge(input.challengeId, hashChatNonce(input.nonce), contentHash);
  if (consumed.status === "nonce_expired") return { status: "expired" };
  if (consumed.status === "nonce_replayed") return { status: "replayed" };
  if (consumed.status !== "ok") return { status: "invalid_challenge" };
  if (consumed.challenge.purpose !== input.purpose) return { status: "invalid_challenge" };

  const validSignature = await verifyChatSignature(consumed.challenge, input.nonce, input.signature);
  if (!validSignature) return { status: "invalid_signature" };

  return { status: "ok", walletAddress: consumed.challenge.walletAddress };
}
