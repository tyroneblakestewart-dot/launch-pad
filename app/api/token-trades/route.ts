import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  TOKEN_TRADES_GRID_READ_LIMIT,
  TOKEN_TRADES_READ_LIMIT,
  consumeTokenTradesGridReadRateLimit,
  consumeTokenTradesReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import { getTokenTrades } from "@/lib/server/token-trades-rpc";

// Real on-chain trade history for a bonding curve (issue #430), replacing
// the "No trades recorded yet" dead end — nothing previously read the
// curve's own TokensPurchased/TokensSold events. Reuses the "token-launches"
// service-isolation switch and System Health pipeline rather than inventing
// a separate one; this route is part of the same token-launches feature
// area (issue #430's own trades-read stage lives on that pipeline).
//
// Two independent per-IP rate-limit buckets (issue #453 area 1): the
// homepage grid (lib/use-grid-token-trades.ts) marks its reads with an
// additive `source=grid` query param so it's charged against
// TOKEN_TRADES_GRID_READ_LIMIT instead of the token-detail page's
// TOKEN_TRADES_READ_LIMIT — the route/response/RPC path is identical either
// way, only the rate-limit bucket differs. See
// lib/server/api-protection.ts's consumeTokenTradesGridReadRateLimit for the
// sizing arithmetic.

export const runtime = "nodejs";

function headers(rate: ReturnType<typeof consumeTokenTradesReadRateLimit>, limit: number, extra: Record<string, string> = {}) {
  return {
    // Both client hooks already fetch with `cache: "no-store"`, and the
    // server's own ~4s cache (lib/server/token-trades-rpc.ts) is the only
    // cache this response needs — a "public, max-age=10" header would let an
    // intermediate/shared cache reuse a response that carries this request's
    // own per-IP rate-limit headers for a different caller (issue #453
    // area 9).
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    ...extra,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const isGridRead = (url.searchParams.get("source") || "").trim() === "grid";
  const limit = isGridRead ? TOKEN_TRADES_GRID_READ_LIMIT : TOKEN_TRADES_READ_LIMIT;
  const rate = isGridRead
    ? consumeTokenTradesGridReadRateLimit(getClientIp(request))
    : consumeTokenTradesReadRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: headers(rate, limit, { "Retry-After": String(rate.retryAfterSeconds) }) },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("token-launches");
  if (isolationResponse) return isolationResponse;

  const curve = (url.searchParams.get("curve") || "").trim();
  if (!isAddress(curve)) {
    return NextResponse.json({ error: "A valid curve address is required." }, { status: 400, headers: headers(rate, limit) });
  }

  try {
    const trades = await getTokenTrades(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, curve);
    return NextResponse.json({ trades }, { status: 200, headers: headers(rate, limit) });
  } catch (error) {
    // The response to the caller stays generic (never provider internals),
    // but Vercel logs keep a bounded, secret-redacted real detail (reusing
    // the same sanitiseProviderDetail already used for other provider-facing
    // routes) so a genuine RPC failure (e.g. "missing trie node ... not
    // found") is still diagnosable from logs alone (issue #453 area 9).
    console.error("Token trades read failed.", sanitiseProviderDetail(error));
    // A genuine RPC/chain-read failure must never be returned as an empty
    // array — that would be indistinguishable from "this token really has
    // no trades yet" to the client.
    return NextResponse.json(
      { error: "Trade history could not be loaded. Try again shortly." },
      { status: 502, headers: headers(rate, limit) },
    );
  }
}
