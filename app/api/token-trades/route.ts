import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  TOKEN_TRADES_READ_LIMIT,
  consumeTokenTradesReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { getTokenTrades } from "@/lib/server/token-trades-rpc";

// Real on-chain trade history for a bonding curve (issue #430), replacing
// the "No trades recorded yet" dead end — nothing previously read the
// curve's own TokensPurchased/TokensSold events. Reuses the "token-launches"
// service-isolation switch and System Health pipeline rather than inventing
// a separate one; this route is part of the same token-launches feature
// area (issue #430's own trades-read stage lives on that pipeline).

export const runtime = "nodejs";

function headers(rate: ReturnType<typeof consumeTokenTradesReadRateLimit>, extra: Record<string, string> = {}) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(TOKEN_TRADES_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    ...extra,
  };
}

export async function GET(request: Request) {
  const rate = consumeTokenTradesReadRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: headers(rate, { "Retry-After": String(rate.retryAfterSeconds) }) },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("token-launches");
  if (isolationResponse) return isolationResponse;

  const url = new URL(request.url);
  const curve = (url.searchParams.get("curve") || "").trim();
  if (!isAddress(curve)) {
    return NextResponse.json({ error: "A valid curve address is required." }, { status: 400, headers: headers(rate) });
  }

  try {
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, curve);
    // The server-side cache TTL (~10s, lib/server/token-trades-rpc.ts) is
    // mirrored here so intermediate caches/browsers reuse the same response
    // instead of re-requesting more often than the data actually changes.
    return NextResponse.json(
      { trades },
      { status: 200, headers: headers(rate, { "Cache-Control": "public, max-age=10" }) },
    );
  } catch (error) {
    console.error("Token trades read failed.", error instanceof Error ? (error.stack ?? error.message) : error);
    // A genuine RPC/chain-read failure must never be returned as an empty
    // array — that would be indistinguishable from "this token really has
    // no trades yet" to the client.
    return NextResponse.json(
      { error: "Trade history could not be loaded. Try again shortly." },
      { status: 502, headers: headers(rate) },
    );
  }
}
