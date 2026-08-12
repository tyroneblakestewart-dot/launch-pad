import { NextRequest, NextResponse } from "next/server";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { fetchRobinhoodTrendingTokens, fetchSolanaTrendingTokens } from "@/lib/server/robinhood-trending";
import { fetchGraduatingTokens } from "@/lib/server/pumpfun-graduating";

// Temporarily forcing every request to run the function instead of serving
// from the ISR cache, to confirm live GMGN responses while debugging the
// "Feed unavailable" issue reported in PR #186.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const isolationResponse = await getServiceIsolationResponse("market-feed");
  if (isolationResponse) return isolationResponse;

  console.log("[trending-route] env check:", {
    hasKey: !!process.env.GMGN_API_KEY,
    keyLength: process.env.GMGN_API_KEY?.length ?? 0,
    nodeEnv: process.env.NODE_ENV,
  });

  const feedParam = request.nextUrl.searchParams.get("feed");
  const feed = feedParam === "solana" ? "solana" : feedParam === "graduating" ? "graduating" : "robinhood";
  const result =
    feed === "solana"
      ? await fetchSolanaTrendingTokens()
      : feed === "graduating"
        ? await fetchGraduatingTokens()
        : await fetchRobinhoodTrendingTokens();
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
