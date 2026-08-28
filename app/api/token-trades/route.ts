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

// Reads one bonding curve's full on-chain buy/sell history (issue #430,
// closing the gap where the Recent trades tab and chart never had a real
// data source). A plain public GET like GET /api/token-launches — no
// wallet signature, no database write — served from
// lib/server/token-trades-rpc.ts's ~10s server-side cache so many viewers
// polling in parallel never becomes a burst of RPC calls. Reuses the
// "token-launches" service-isolation switch rather than adding a new one:
// this route is the same Milestone A token-page feature area, following
// the precedent of curve-progress-cache.ts's own curve-progress-read stage
// living on that same pipeline instead of getting its own switch.

export const runtime = "nodejs";

function readHeaders(rate: ReturnType<typeof consumeTokenTradesReadRateLimit>) {
  return {
    // Server-side caching already bounds RPC load to ~10s freshness
    // (lib/server/token-trades-rpc.ts); telling intermediate caches the
    // same freshness window lets them absorb load too, on top of (not
    // instead of) the per-IP rate limit below.
    "Cache-Control": "public, max-age=10",
    "X-RateLimit-Limit": String(TOKEN_TRADES_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

export async function GET(request: Request) {
  const rate = consumeTokenTradesReadRateLimit(getClientIp(request));
  const headers = readHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("token-launches");
  if (isolationResponse) return isolationResponse;

  const url = new URL(request.url);
  const curveParam = (url.searchParams.get("curve") || "").trim();
  const chainIdParam = url.searchParams.get("chainId");
  const chainId = chainIdParam ? Number(chainIdParam) : ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL;

  if (!isAddress(curveParam)) {
    return NextResponse.json(
      { error: "A valid curve address is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (chainId !== ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL) {
    return NextResponse.json(
      { error: "Only Robinhood Chain Testnet trades can be read today." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const trades = await getTokenTrades(chainId, curveParam);
    if (trades === null) {
      // Distinct from a genuine zero-trades result: the read itself failed
      // and nothing was cached yet, so the client must not render this as
      // an empty state (issue #430: "Empty state only when the route
      // returns zero trades").
      return NextResponse.json(
        { error: "Trade history could not be read from the chain. Try again shortly." },
        { status: 502, headers: { ...headers, "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ trades }, { status: 200, headers });
  } catch (error) {
    console.error(
      "Token trades read failed unexpectedly.",
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return NextResponse.json(
      { error: "Trade history could not be loaded. Try again." },
      { status: 500, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}
