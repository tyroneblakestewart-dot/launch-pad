import { hashChatMessageContent, hashChatNonce, tryConsumeChatChallenge, verifyChatSignature } from "@/lib/server/chat-auth";

// Shared wallet-signed action auth for Social Studio connect/disconnect and
// post approve/cancel (issue #335) — reuses lib/server/chat-auth.ts's
// generic challenge/signature primitives (issue #237) instead of
// duplicating a near-identical module, the same way hoodchat and token-chat
// already share it. Every action purpose gets its own contentHash binding
// so a signed challenge for one action can never be replayed against
// another.

export const SOCIAL_STUDIO_ACTION_PURPOSES = [
  "social:x-connect",
  "social:x-disconnect",
  "social:telegram-connect",
  "social:telegram-disconnect",
  "social:post-create",
  "social:post-cancel",
] as const;

export type SocialStudioActionPurpose = (typeof SOCIAL_STUDIO_ACTION_PURPOSES)[number];

export function isSocialStudioActionPurpose(value: unknown): value is SocialStudioActionPurpose {
  return typeof value === "string" && (SOCIAL_STUDIO_ACTION_PURPOSES as readonly string[]).includes(value);
}

/** Deterministically hashes a flat string-valued payload so both challenge issuance and action consumption compute the same value regardless of key order. */
export function hashSocialStudioAction(purpose: SocialStudioActionPurpose, payload: Record<string, string>): string {
  const canonical = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join("&");
  return hashChatMessageContent(`${purpose}:${canonical}`);
}

export type AuthoriseSocialStudioActionInput = {
  purpose: SocialStudioActionPurpose;
  payload: Record<string, string>;
  challengeId: string;
  nonce: string;
  signature: string;
};

export type AuthoriseSocialStudioActionResult =
  | { status: "ok"; walletAddress: string }
  | { status: "invalid_challenge" }
  | { status: "expired" }
  | { status: "replayed" }
  | { status: "invalid_signature" };

/** Consumes a challenge issued by POST /api/social/challenge and verifies the wallet's signature over it, bound to this exact purpose+payload. */
export async function authoriseSocialStudioAction(
  input: AuthoriseSocialStudioActionInput,
): Promise<AuthoriseSocialStudioActionResult> {
  const contentHash = hashSocialStudioAction(input.purpose, input.payload);
  const consumed = tryConsumeChatChallenge(input.challengeId, hashChatNonce(input.nonce), contentHash);
  if (consumed.status === "nonce_expired") return { status: "expired" };
  if (consumed.status === "nonce_replayed") return { status: "replayed" };
  if (consumed.status !== "ok") return { status: "invalid_challenge" };
  if (consumed.challenge.purpose !== input.purpose) return { status: "invalid_challenge" };

  const validSignature = await verifyChatSignature(consumed.challenge, input.nonce, input.signature);
  if (!validSignature) return { status: "invalid_signature" };

  return { status: "ok", walletAddress: consumed.challenge.walletAddress };
}
