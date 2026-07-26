import { createHash, randomBytes } from "node:crypto";
import { getAddress, verifyMessage } from "viem";

export const PUBLISH_NONCE_TTL_MS = 5 * 60 * 1000;
export const PUBLISH_PURPOSE = "publish_generated_site";
export const PUBLISH_DOMAIN = "hoodlums.dev";

export type PublishChallenge = {
  id: string;
  nonceHash: string;
  walletAddress: string;
  slug: string;
  walletChainId: number;
  sitePayloadHash: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

export type PublishChallengeMessageInput = Pick<
  PublishChallenge,
  | "id"
  | "walletAddress"
  | "slug"
  | "walletChainId"
  | "sitePayloadHash"
  | "issuedAt"
  | "expiresAt"
> & {
  nonce: string;
};

export function normalisePublishWalletAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value.trim());
  } catch {
    return null;
  }
}

export function normaliseWalletChainId(value: unknown): number | null {
  const chainId = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(chainId) && chainId > 0 && chainId <= 2_147_483_647
    ? chainId
    : null;
}

export function createPublishNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function createDraftToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPublishNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export function buildPublishAuthorisationMessage(input: PublishChallengeMessageInput): string {
  const publicUrl = `https://${PUBLISH_DOMAIN}/${input.slug}`;
  return `${PUBLISH_DOMAIN} wants you to authorize publishing with your Ethereum account:
${input.walletAddress}

Publish the exact generated token site represented by the payload hash below at ${publicUrl}. This is a message signature only; it does not send a transaction or spend gas.

URI: ${publicUrl}
Version: 1
Chain ID: ${input.walletChainId}
Nonce: ${input.nonce}
Issued At: ${input.issuedAt.toISOString()}
Expiration Time: ${input.expiresAt.toISOString()}
Request ID: ${input.id}
Purpose: ${PUBLISH_PURPOSE}
Site Payload Hash: ${input.sitePayloadHash}`;
}

export async function verifyPublishSignature(
  challenge: PublishChallenge,
  nonce: string,
  signature: unknown,
  now = new Date(),
): Promise<boolean> {
  if (challenge.usedAt) return false;
  if (challenge.expiresAt.getTime() <= now.getTime()) return false;
  if (hashPublishNonce(nonce) !== challenge.nonceHash) return false;
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) return false;

  const message = buildPublishAuthorisationMessage({
    ...challenge,
    nonce,
  });

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
