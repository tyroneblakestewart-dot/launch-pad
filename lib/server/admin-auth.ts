import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage } from "viem";

export const ADMIN_NONCE_TTL_MS = 5 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_COOKIE = "hoodlums_admin_session";
export const ADMIN_LOGIN_PURPOSE = "admin_dashboard_login";
export const ADMIN_LOGIN_DOMAIN = "hoodlums.dev";

export type AdminChallenge = {
  id: string;
  nonceHash: string;
  walletAddress: string;
  issuedAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

export type AdminChallengeMessageInput = Pick<
  AdminChallenge,
  "id" | "walletAddress" | "issuedAt" | "expiresAt"
> & {
  nonce: string;
};

/** The single wallet address allowed to sign in, read only from the server. */
export function getAdminWalletAddress(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.ADMIN_WALLET_ADDRESS?.trim();
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

export function normaliseAdminWalletAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return getAddress(value.trim());
  } catch {
    return null;
  }
}

export function createAdminNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function hashAdminNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex");
}

export function buildAdminAuthorisationMessage(input: AdminChallengeMessageInput): string {
  return `${ADMIN_LOGIN_DOMAIN} wants you to authorize an admin dashboard sign-in with your Ethereum account:
${input.walletAddress}

This is a message signature only; it does not send a transaction or spend gas.

Version: 1
Nonce: ${input.nonce}
Issued At: ${input.issuedAt.toISOString()}
Expiration Time: ${input.expiresAt.toISOString()}
Request ID: ${input.id}
Purpose: ${ADMIN_LOGIN_PURPOSE}`;
}

export async function verifyAdminWalletSignature(
  challenge: AdminChallenge,
  nonce: string,
  signature: unknown,
  now = new Date(),
): Promise<boolean> {
  if (challenge.usedAt) return false;
  if (challenge.expiresAt.getTime() <= now.getTime()) return false;
  if (hashAdminNonce(nonce) !== challenge.nonceHash) return false;
  if (typeof signature !== "string" || !/^0x[0-9a-f]+$/i.test(signature)) return false;

  const message = buildAdminAuthorisationMessage({ ...challenge, nonce });

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

/**
 * Constant-time comparison. Both sides are hashed to a fixed-length digest
 * first so differing input lengths never short-circuit `timingSafeEqual`
 * (which throws on mismatched buffer lengths) or leak length via timing.
 */
function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Verifies a supplied admin password against ADMIN_PASSWORD in constant time.
 * Returns false (never throws) when ADMIN_PASSWORD is not configured, so the
 * password login path fails closed rather than accepting an empty secret.
 * Never logs the supplied or configured password.
 */
export function verifyAdminPassword(
  supplied: unknown,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const configured = env.ADMIN_PASSWORD?.trim() || "";
  if (!configured || typeof supplied !== "string" || !supplied) return false;
  return safeEqual(supplied, configured);
}

export function createAdminSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAdminSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Reads the raw session token out of a `Cookie` request header, if present. */
export function parseAdminSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== ADMIN_SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}
