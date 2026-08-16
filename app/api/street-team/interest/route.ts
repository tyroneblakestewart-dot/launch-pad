import { NextResponse } from "next/server";
import {
  STREET_TEAM_INTEREST_LIMIT,
  consumeStreetTeamInterestRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import {
  StreetTeamInterestStoreUnavailableError,
  getStreetTeamInterestStore,
} from "@/lib/server/street-team-interest-store";

export const runtime = "nodejs";

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.STREET_TEAM_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

function responseHeaders(rate: ReturnType<typeof consumeStreetTeamInterestRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(STREET_TEAM_INTEREST_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

/** Public, unauthenticated check so a returning connected wallet sees its confirmed state on load. */
export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet") || "";
  const headers = { "Cache-Control": "no-store" };
  if (!WALLET_PATTERN.test(wallet)) {
    return NextResponse.json({ registered: false }, { status: 200, headers });
  }

  try {
    const registered = await getStreetTeamInterestStore().hasInterest(wallet);
    return NextResponse.json({ registered }, { status: 200, headers });
  } catch {
    return NextResponse.json({ registered: false }, { status: 200, headers });
  }
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json(
      { error: "Street Team interest request origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumeStreetTeamInterestRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const walletAddressRaw = typeof body?.walletAddress === "string" ? body.walletAddress.trim() : "";
  if (walletAddressRaw && !WALLET_PATTERN.test(walletAddressRaw)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400, headers });
  }

  try {
    const record = await getStreetTeamInterestStore().recordInterest(walletAddressRaw || null);
    return NextResponse.json({ registered: true, record }, { status: 201, headers });
  } catch (error) {
    const unavailable = error instanceof StreetTeamInterestStoreUnavailableError;
    return NextResponse.json(
      {
        error: unavailable
          ? "Street Team interest capture is not configured on this deployment."
          : "Interest could not be recorded.",
      },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
