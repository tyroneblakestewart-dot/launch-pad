import { NextRequest, NextResponse } from "next/server";
import { fetchRobinhoodTrendingTokens, fetchSolanaTrendingTokens } from "@/lib/server/robinhood-trending";

// Temporarily forcing every request to run the function instead of serving
// from the ISR cache, to confirm live GMGN responses while debugging the
// "Feed unavailable" issue reported in PR #186.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  console.log("[trending-route] env check:", {
    hasKey: !!process.env.GMGN_API_KEY,
    keyLength: process.env.GMGN_API_KEY?.length ?? 0,
    nodeEnv: process.env.NODE_ENV,
  });

  const feed = request.nextUrl.searchParams.get("feed") === "solana" ? "solana" : "robinhood";
  const result = feed === "solana" ? await fetchSolanaTrendingTokens() : await fetchRobinhoodTrendingTokens();
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
