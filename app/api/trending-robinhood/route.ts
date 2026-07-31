import { NextResponse } from "next/server";
import { fetchRobinhoodTrendingTokens } from "@/lib/server/robinhood-trending";

export const revalidate = 60;

export async function GET() {
  const result = await fetchRobinhoodTrendingTokens();
  return NextResponse.json(result, {
    headers: { "Cache-Control": result.error ? "no-store" : "public, max-age=60" },
  });
}
