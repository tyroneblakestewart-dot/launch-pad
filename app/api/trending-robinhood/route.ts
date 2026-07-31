import { NextResponse } from "next/server";
import { fetchRobinhoodTrendingTokens } from "@/lib/server/robinhood-trending";

// Temporarily forcing every request to run the function instead of serving
// from the ISR cache, to confirm live GMGN responses while debugging the
// "Feed unavailable" issue reported in PR #186.
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await fetchRobinhoodTrendingTokens();
  return NextResponse.json(result, {
    headers: { "Cache-Control": result.error ? "no-store" : "public, max-age=60" },
  });
}
