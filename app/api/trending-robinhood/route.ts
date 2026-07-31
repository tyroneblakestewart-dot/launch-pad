import { NextResponse } from "next/server";
import { fetchRobinhoodTrendingTokens } from "@/lib/server/robinhood-trending";

// Forcing every request to run the function instead of serving from the ISR
// cache: `fetchRobinhoodTrendingTokens` keeps its own short-lived cache, so
// this always reflects that cache's freshness rather than a stale build-time
// snapshot.
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchRobinhoodTrendingTokens();
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
    },
  });
}
