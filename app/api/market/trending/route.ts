import { NextResponse } from "next/server";
import {
  getRobinhoodTrendingTokens,
  isGmgnTrendingInterval,
} from "@/lib/server/gmgn-trending";

export const runtime = "nodejs";
export const maxDuration = 15;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=45, stale-while-revalidate=120",
};

export async function GET(request: Request) {
  const interval = new URL(request.url).searchParams.get("interval") || "5m";
  if (!isGmgnTrendingInterval(interval)) {
    return NextResponse.json(
      { error: "Choose a supported market interval: 5m or 1h." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await getRobinhoodTrendingTokens(interval);
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    const message =
      error instanceof Error && error.message === "GMGN market data is not configured."
        ? error.message
        : "Robinhood Chain market activity is temporarily unavailable.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("not configured") ? 503 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
