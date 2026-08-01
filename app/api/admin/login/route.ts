import { NextResponse } from "next/server";
import {
  ADMIN_LOGIN_LIMIT,
  consumeAdminLoginRateLimit,
  getClientIp,
  isAdminRequestOriginAllowed,
} from "@/lib/server/api-protection";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  getAdminWalletAddress,
  hashAdminSessionToken,
  verifyAdminPassword,
  verifyAdminWalletSignature,
} from "@/lib/server/admin-auth";
import {
  createAdminSession,
  getAdminChallenge,
  markAdminChallengeUsed,
} from "@/lib/server/admin-session-store";

export const runtime = "nodejs";

function responseHeaders(rate: ReturnType<typeof consumeAdminLoginRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(ADMIN_LOGIN_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function unauthorised(message: string, headers: Record<string, string>) {
  return NextResponse.json({ error: message }, { status: 401, headers });
}

function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

async function loginWithWallet(body: Record<string, unknown>, headers: Record<string, string>) {
  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";

  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9_-]{20,128}$/.test(nonce)) {
    return NextResponse.json({ error: "A valid admin challenge is required." }, { status: 400, headers });
  }

  const challenge = getAdminChallenge(challengeId);
  const adminWalletAddress = getAdminWalletAddress();
  if (!challenge || !adminWalletAddress || challenge.walletAddress !== adminWalletAddress) {
    return unauthorised("Wallet admin authorisation failed.", headers);
  }
  if (!(await verifyAdminWalletSignature(challenge, nonce, signature))) {
    return unauthorised("Wallet admin authorisation failed.", headers);
  }

  markAdminChallengeUsed(challenge.id);
  return grantSession(headers);
}

function loginWithPassword(body: Record<string, unknown>, headers: Record<string, string>) {
  const password = body.password;
  if (!process.env.ADMIN_PASSWORD?.trim()) {
    return NextResponse.json(
      { error: "Password admin login is not configured on this deployment." },
      { status: 503, headers },
    );
  }
  if (!verifyAdminPassword(password)) {
    return unauthorised("Incorrect admin password.", headers);
  }
  return grantSession(headers);
}

function grantSession(headers: Record<string, string>) {
  const token = createAdminSessionToken();
  const expiresAt = createAdminSession(hashAdminSessionToken(token));
  const response = NextResponse.json({ authenticated: true }, { status: 200, headers });
  setSessionCookie(response, token, expiresAt);
  return response;
}

/**
 * Never lets an unexpected error escape unhandled: on Vercel an uncaught
 * throw/rejection inside a route handler can terminate the function before
 * any response is written, which surfaces to the browser as a network
 * failure (no status code at all) rather than a normal 5xx. This guarantees
 * a JSON response is always returned. The caught error is logged server-side
 * only (never the request body, which may hold the admin password).
 */
export async function POST(request: Request) {
  try {
    if (!isAdminRequestOriginAllowed(request)) {
      return NextResponse.json(
        { error: "Admin login origin is not allowed." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }

    const rate = consumeAdminLoginRateLimit(getClientIp(request));
    const headers = responseHeaders(rate);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many admin login attempts. Try again later." },
        { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "A login method is required." }, { status: 400, headers });
    }

    if (body.method === "wallet") return await loginWithWallet(body, headers);
    if (body.method === "password") return loginWithPassword(body, headers);
    return NextResponse.json({ error: "Unsupported admin login method." }, { status: 400, headers });
  } catch (error) {
    console.error(
      "Admin login failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "Admin login failed unexpectedly. Try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
