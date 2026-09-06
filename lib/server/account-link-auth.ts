import { hashChatMessageContent, hashChatNonce, tryConsumeChatChallenge, verifyChatSignature } from "@/lib/server/chat-auth";

// Wallet-signed auth for binding a wallet to a Google-signed-in account
// (phase 1, 6 Sep 2026) — the same challenge/signature primitives Hoodchat,
// Social Studio and Support already share (lib/server/chat-auth.ts), with its
// own purpose and its own challenge route so isolating any of those services
// never blocks account linking and vice versa. The payload binds the
// challenge to the exact account id the session belongs to, so a signature
// collected for one account can never link a wallet to another.

export const ACCOUNT_ACTION_PURPOSES = ["account:link-wallet"] as const;

export type AccountActionPurpose = (typeof ACCOUNT_ACTION_PURPOSES)[number];

export function isAccountActionPurpose(value: unknown): value is AccountActionPurpose {
  return typeof value === "string" && (ACCOUNT_ACTION_PURPOSES as readonly string[]).includes(value);
}

export function hashAccountAction(purpose: AccountActionPurpose, payload: Record<string, string>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("&");
  return hashChatMessageContent(`${purpose}:${canonical}`);
}

export type AuthoriseAccountActionInput = {
  purpose: AccountActionPurpose;
  payload: Record<string, string>;
  challengeId: string;
  nonce: string;
  signature: string;
};

export type AuthoriseAccountActionResult =
  | { status: "ok"; walletAddress: string }
  | { status: "invalid_challenge" }
  | { status: "expired" }
  | { status: "replayed" }
  | { status: "invalid_signature" };

export async function authoriseAccountAction(input: AuthoriseAccountActionInput): Promise<AuthoriseAccountActionResult> {
  const contentHash = hashAccountAction(input.purpose, input.payload);
  const consumed = tryConsumeChatChallenge(input.challengeId, hashChatNonce(input.nonce), contentHash);
  if (consumed.status === "nonce_expired") return { status: "expired" };
  if (consumed.status === "nonce_replayed") return { status: "replayed" };
  if (consumed.status !== "ok") return { status: "invalid_challenge" };
  if (consumed.challenge.purpose !== input.purpose) return { status: "invalid_challenge" };

  const validSignature = await verifyChatSignature(consumed.challenge, input.nonce, input.signature);
  if (!validSignature) return { status: "invalid_signature" };

  return { status: "ok", walletAddress: consumed.challenge.walletAddress };
}
