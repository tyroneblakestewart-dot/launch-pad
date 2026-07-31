import { NextResponse } from "next/server";
import { getRobinhoodTrending } from "@/lib/server/robinhood-trending";

// Matches the ~60s in-memory cache in lib/server/robinhood-trending.ts.
export const revalidate = 60;

export async function GET() {
  const result = await getRobinhoodTrending();
  return NextResponse.json(result, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=30" },
  });
}
