import { createHash, randomBytes } from "node:crypto";
import { getUserAccountsStore, type UserAccount } from "@/lib/server/user-accounts-store";

// Session cookie for Google-signed-in users (phase 1, 6 Sep 2026), built the
// same way as the admin session (lib/server/admin-auth.ts): a random token in
// an httpOnly cookie, only its SHA-256 stored. Thirty days, sliding on sign-in
// only. Presence of a session never authorises a paid or on-chain action —
// those still take a wallet signature; the session only says who is looking.

export const ACCOUNT_SESSION_COOKIE = "hoodlums_account_session";
export const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createAccountSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAccountSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Reads one named cookie out of a raw `Cookie` header, if present.
 *
 * Next's `response.cookies.set()` serialises values with `encodeURIComponent`,
 * so a value carrying `:`, `+`, `/` or `=` (the sealed Google OAuth state is
 * base64 segments joined by `:`) comes back as `%3A`, `%2B`… — this decodes
 * it again. A value that is not valid percent-encoding is returned as-is.
 */
export function parseCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      const value = rest.join("=").trim();
      if (!value) return null;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export function parseAccountSessionCookie(cookieHeader: string | null | undefined): string | null {
  return parseCookieValue(cookieHeader, ACCOUNT_SESSION_COOKIE);
}

export function accountSessionCookieOptions(expiresAt: Date, env: Record<string, string | undefined> = process.env) {
  return {
    name: ACCOUNT_SESSION_COOKIE,
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/** The signed-in account for this request, or null (no cookie, unknown token, expired session, or storage unconfigured). Never throws. */
export async function readAccountSession(request: Request, now = new Date()): Promise<UserAccount | null> {
  const token = parseAccountSessionCookie(request.headers.get("cookie"));
  if (!token) return null;
  try {
    return await getUserAccountsStore().getSessionAccount(hashAccountSessionToken(token), now);
  } catch {
    return null;
  }
}
