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
