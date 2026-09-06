import { getAddress, isHash, keccak256, stringToHex } from "viem";

export const BESPOKE_SITE_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const BESPOKE_SITE_ACCESS_PURPOSE = "generate_bespoke_site";
export const BESPOKE_SITE_UPSELL_EVENT = "launchpad:bespoke-site-upsell";

export type BespokeSiteProjectIdentity = {
  name?: unknown;
  ticker?: unknown;
  description?: unknown;
  inspirationUrl?: unknown;
};

export type BespokeSiteChallengeMessageInput = {
  challengeId: string;
  nonce: string;
  walletAddress: string;
  origin: string;
  issuedAt: string;
  expiresAt: string;
  projectHash: `0x${string}`;
};

export type BespokeSiteChallengeResponse = BespokeSiteChallengeMessageInput & {
  message: string;
  tier: "test_access" | "bond_pro_site" | "pro" | "pro_bundle";
  accessSource: "paid" | "test-allowlist";
  /** Paid wallets: the generation allowance before this generation. Absent for test access. */
  attempts?: BespokeAttempts;
};

export type BespokeSiteAccessProof = {
  challengeId: string;
  nonce: string;
  signature: `0x${string}`;
};

export type BespokeSiteUpsellEventDetail = {
  message: string;
  checkoutPlan: "bond-pro-site";
};

// Three generations per one-off purchase (owner decisions, 6 Sep 2026). The
// allowance is 3 × the wallet's recorded Bond + Pro Site payments; `used` is
// the number of pages the server actually delivered. Pro / Pro Bundle are
// Social Studio subscriptions and grant no website at all.
export const BESPOKE_GENERATIONS_PER_PURCHASE = 3;
export const BESPOKE_ATTEMPTS_USED_CODE = "bespoke-attempts-used";

export type BespokeAttempts = {
  allowance: number;
  used: number;
  remaining: number;
};

export function bespokeAttempts(purchaseCount: number, used: number): BespokeAttempts {
  const allowance = Math.max(0, Math.floor(purchaseCount)) * BESPOKE_GENERATIONS_PER_PURCHASE;
  const spent = Math.max(0, Math.floor(used));
  return { allowance, used: spent, remaining: Math.max(0, allowance - spent) };
}

export function isBespokeAttempts(value: unknown): value is BespokeAttempts {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.allowance === "number" && typeof candidate.used === "number" && typeof candidate.remaining === "number"
  );
}

export function bespokeAttemptsUsedMessage(attempts: BespokeAttempts): string {
  return `You've used all ${attempts.allowance} bespoke designs for this purchase. Keep one of the designs saved in your studio, or buy Bond + Pro Site again for 3 more.`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normaliseBespokeSiteOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Binds a one-time wallet challenge to the small project identity fields that
 * shape the bespoke prompt. The artwork data URL is deliberately excluded so
 * an iPhone does not duplicate several megabytes of image data merely to hash
 * it; the generation route still validates the artwork independently.
 */
export function hashBespokeSiteProject(
  value: BespokeSiteProjectIdentity,
): `0x${string}` {
  const canonical = {
    name: text(value.name).trim().slice(0, 40) || "Untitled token",
    ticker: text(value.ticker).trim().slice(0, 12) || "TOKEN",
    description:
      text(value.description).trim().slice(0, 500) || "Community token project",
    inspirationUrl: text(value.inspirationUrl).trim().slice(0, 501),
  };
  return keccak256(stringToHex(JSON.stringify(canonical)));
}

export function buildBespokeSiteChallengeMessage(
  challenge: BespokeSiteChallengeMessageInput,
): string {
  const origin = normaliseBespokeSiteOrigin(challenge.origin);
  if (
    !origin ||
    !challenge.challengeId.trim() ||
    !challenge.nonce.trim() ||
    !isHash(challenge.projectHash)
  ) {
    throw new Error("The bespoke-site wallet challenge is invalid.");
  }
  const walletAddress = getAddress(challenge.walletAddress);
  const host = new URL(origin).host;

  return `${host} wants you to authorize one bespoke Hoodlums website generation with your Ethereum account:
${walletAddress}

This is a one-time message signature only. It does not send a transaction, spend gas, or give Hoodlums control of your wallet.

URI: ${origin}
Version: 1
Purpose: ${BESPOKE_SITE_ACCESS_PURPOSE}
Nonce: ${challenge.nonce}
Issued At: ${challenge.issuedAt}
Expiration Time: ${challenge.expiresAt}
Request ID: ${challenge.challengeId}
Project Hash: ${challenge.projectHash}`;
}
