import { NextResponse } from "next/server";
import { fetchRobinhoodTrendingTokens } from "@/lib/server/robinhood-trending";

// Temporarily forcing every request to run the function instead of serving
// from the ISR cache, to confirm live GMGN responses while debugging the
// "Feed unavailable" issue reported in PR #186.
export const dynamic = "force-dynamic";

export async function GET() {
  console.log("[trending-route] env check:", {
    hasKey: !!process.env.GMGN_API_KEY,
    keyLength: process.env.GMGN_API_KEY?.length ?? 0,
    nodeEnv: process.env.NODE_ENV,
  });

  const result = await fetchRobinhoodTrendingTokens();
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
