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
  hashAdminNonce,
  hashAdminSessionToken,
  verifyAdminPassword,
  verifyAdminWalletSignature,
} from "@/lib/server/admin-auth";
import {
  AdminSessionStoreUnavailableError,
  consumeAdminChallengeAndCreateSession,
  createAdminSession,
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

function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
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

function authenticatedResponse(
  headers: Record<string, string>,
  token: string,
  expiresAt: Date,
): NextResponse {
  const response = NextResponse.json(
    { authenticated: true },
    { status: 200, headers },
  );
  setSessionCookie(response, token, expiresAt);
  return response;
}

async function loginWithWallet(
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<NextResponse> {
  const challengeId =
    typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
  const signature =
    typeof body.signature === "string" ? body.signature.trim() : "";

  if (
    !/^[0-9a-f-]{36}$/i.test(challengeId) ||
    !/^[A-Za-z0-9_-]{20,128}$/.test(nonce)
  ) {
    return NextResponse.json(
      { error: "A valid admin challenge is required." },
      { status: 400, headers },
    );
  }

  const adminWalletAddress = getAdminWalletAddress();
  if (!adminWalletAddress) {
    return unauthorised("Wallet admin authorisation failed.", headers);
  }

  const token = createAdminSessionToken();
  const now = new Date();
  const result = await consumeAdminChallengeAndCreateSession(
    {
      challengeId,
      nonceHash: hashAdminNonce(nonce),
      sessionTokenHash: hashAdminSessionToken(token),
      now,
    },
    async (challenge) =>
      challenge.walletAddress === adminWalletAddress &&
      (await verifyAdminWalletSignature(challenge, nonce, signature, now)),
  );

  if (result.status !== "authenticated") {
    return unauthorised("Wallet admin authorisation failed.", headers);
  }

  return authenticatedResponse(headers, token, result.expiresAt);
}

async function loginWithPassword(
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<NextResponse> {
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

  const token = createAdminSessionToken();
  const expiresAt = await createAdminSession(hashAdminSessionToken(token));
  return authenticatedResponse(headers, token, expiresAt);
}

/**
 * Always returns a JSON response. The caught error is logged server-side only;
 * the request body is never logged because it may contain the admin password.
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
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": String(rate.retryAfterSeconds),
          },
        },
      );
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json(
        { error: "A login method is required." },
        { status: 400, headers },
      );
    }

    if (body.method === "wallet") return await loginWithWallet(body, headers);
    if (body.method === "password") {
      return await loginWithPassword(body, headers);
    }
    return NextResponse.json(
      { error: "Unsupported admin login method." },
      { status: 400, headers },
    );
  } catch (error) {
    if (error instanceof AdminSessionStoreUnavailableError) {
      return NextResponse.json(
        {
          error:
            "Admin sign-in storage is not configured. Apply the database migrations and try again.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

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
