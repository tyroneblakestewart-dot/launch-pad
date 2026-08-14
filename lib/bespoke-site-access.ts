import { getAddress, isHash, keccak256, stringToHex } from "viem";

export const BESPOKE_SITE_ACCESS_PROOF_TTL_MS = 5 * 60 * 1_000;
export const BESPOKE_SITE_ACCESS_PROOF_FUTURE_SKEW_MS = 60 * 1_000;
export const BESPOKE_SITE_ACCESS_PURPOSE = "generate_bespoke_site";

export type BespokeSiteProjectIdentity = {
  name?: unknown;
  ticker?: unknown;
  description?: unknown;
  inspirationUrl?: unknown;
};

export type UnsignedBespokeSiteAccessProof = {
  walletAddress: string;
  origin: string;
  issuedAt: string;
  expiresAt: string;
  projectHash: `0x${string}`;
};

export type BespokeSiteAccessProof = UnsignedBespokeSiteAccessProof & {
  signature: `0x${string}`;
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
 * Binds the wallet proof to the small project identity fields that shape the
 * bespoke prompt. The artwork data URL is deliberately excluded so an iPhone
 * does not duplicate several megabytes of image data merely to hash it.
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

export function buildBespokeSiteAccessMessage(
  proof: UnsignedBespokeSiteAccessProof,
): string {
  const origin = normaliseBespokeSiteOrigin(proof.origin);
  if (!origin || !isHash(proof.projectHash)) {
    throw new Error("The bespoke-site wallet proof is invalid.");
  }
  const walletAddress = getAddress(proof.walletAddress);
  const host = new URL(origin).host;

  return `${host} wants you to authorize a bespoke Hoodlums website request with your Ethereum account:
${walletAddress}

This is a message signature only. It does not send a transaction, spend gas, or give Hoodlums control of your wallet.

URI: ${origin}
Version: 1
Purpose: ${BESPOKE_SITE_ACCESS_PURPOSE}
Issued At: ${proof.issuedAt}
Expiration Time: ${proof.expiresAt}
Project Hash: ${proof.projectHash}`;
}

export function createUnsignedBespokeSiteAccessProof(input: {
  walletAddress: string;
  origin: string;
  project: BespokeSiteProjectIdentity;
  now?: Date;
}): { proof: UnsignedBespokeSiteAccessProof; message: string } {
  const issuedAt = input.now ?? new Date();
  const proof: UnsignedBespokeSiteAccessProof = {
    walletAddress: getAddress(input.walletAddress),
    origin: normaliseBespokeSiteOrigin(input.origin) || "",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + BESPOKE_SITE_ACCESS_PROOF_TTL_MS,
    ).toISOString(),
    projectHash: hashBespokeSiteProject(input.project),
  };
  return { proof, message: buildBespokeSiteAccessMessage(proof) };
}
