import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  TOKEN_HOLDER_STATS_READ_LIMIT,
  consumeTokenHolderStatsReadRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { sanitiseProviderDetail } from "@/lib/server/sanitise-provider-detail";
import { getTokenHolderBreakdown } from "@/lib/server/token-holder-stats";

// Holder breakdown for the token page's Stats panel (token page v2 part 3):
// Top 10 % / Dev % / Snipers %, per design/token-page-v2/
// token-page-data-inventory.md section 8's "needs one new server route —
// /api/token-holder-stats (cached ~60s)". Reuses the "token-launches"
// service-isolation switch and System Health pipeline (a `holder-stats-read`
// stage) exactly as /api/token-trades does — this is the same feature area,
// not a new service.

export const runtime = "nodejs";

function headers(rate: ReturnType<typeof consumeTokenHolderStatsReadRateLimit>, extra: Record<string, string> = {}) {
  return {
    // The client hook fetches with `cache: "no-store"`, and the server's own
    // ~60s cache (lib/server/token-holder-stats.ts) is the only cache this
    // response needs — a shared/intermediate cache could otherwise reuse a
    // response carrying one caller's rate-limit headers for another.
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(TOKEN_HOLDER_STATS_READ_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
    ...extra,
  };
}

export async function GET(request: Request) {
  const rate = consumeTokenHolderStatsReadRateLimit(getClientIp(request));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: headers(rate, { "Retry-After": String(rate.retryAfterSeconds) }) },
    );
  }

  const isolationResponse = await getServiceIsolationResponse("token-launches");
  if (isolationResponse) return isolationResponse;

  const url = new URL(request.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!isAddress(token)) {
    return NextResponse.json({ error: "A valid token address is required." }, { status: 400, headers: headers(rate) });
  }

  try {
    const stats = await getTokenHolderBreakdown(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, token);
    return NextResponse.json({ stats }, { status: 200, headers: headers(rate) });
  } catch (error) {
    // Generic to the caller, real (secret-redacted, bounded) detail in the
    // server logs — the same split /api/token-trades uses.
    console.error("Token holder stats read failed.", sanitiseProviderDetail(error));
    // A genuine chain-read failure must never come back as a zero-filled
    // breakdown — the panel shows "—" for every row instead.
    return NextResponse.json(
      { error: "Holder stats could not be loaded. Try again shortly." },
      { status: 502, headers: headers(rate) },
    );
  }
}
