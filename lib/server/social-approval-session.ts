import { createAccountSessionToken, hashAccountSessionToken, parseCookieValue } from "@/lib/server/account-session";
import { getSocialApprovalSessionStore, type ApprovalSession } from "@/lib/server/social-approval-session-store";

// One wallet signature unlocks Social Studio post approvals for a day (owner
// direction, 6 Sep 2026). Same cookie mechanics as the account session: a
// random token in an httpOnly cookie, only its SHA-256 stored. The session
// authorises exactly one thing — POST /api/social/posts for the wallet that
// signed — and nothing paid, on-chain, or account-changing.

export const SOCIAL_APPROVAL_SESSION_COOKIE = "hoodlums_social_approval";
export const SOCIAL_APPROVAL_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** The purpose the wallet signs, through the shared /api/social/challenge flow. */
export const SOCIAL_APPROVAL_SESSION_PURPOSE = "social:approval-session" as const;
/** The signed payload — flat strings, so the wallet prompt's content hash names what is being granted. */
export const SOCIAL_APPROVAL_SESSION_PAYLOAD: Record<string, string> = { grant: "approve-posts", validFor: "24h" };

export const createSocialApprovalSessionToken = createAccountSessionToken;
export const hashSocialApprovalSessionToken = hashAccountSessionToken;

export function parseSocialApprovalSessionCookie(cookieHeader: string | null | undefined): string | null {
  return parseCookieValue(cookieHeader, SOCIAL_APPROVAL_SESSION_COOKIE);
}

export function socialApprovalSessionCookieOptions(expiresAt: Date, env: Record<string, string | undefined> = process.env) {
  return {
    name: SOCIAL_APPROVAL_SESSION_COOKIE,
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/** The live approval session behind the request's cookie, or null (no cookie, unknown, expired, revoked, or store unreadable — every case means "ask for a signature"). */
export async function readSocialApprovalSession(request: Request, now = new Date()): Promise<ApprovalSession | null> {
  const token = parseSocialApprovalSessionCookie(request.headers.get("cookie"));
  if (!token) return null;
  try {
    return await getSocialApprovalSessionStore().get(hashSocialApprovalSessionToken(token), now);
  } catch (error) {
    console.error("Approval session read failed", error instanceof Error ? error.message : error);
    return null;
  }
}
