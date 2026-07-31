import { GmgnTrendingError, getRobinhoodTrending } from "@/lib/gmgn-trending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_CACHE = "public, s-maxage=30, stale-while-revalidate=60";
const NO_STORE = "no-store, max-age=0";

export async function GET() {
  try {
    const snapshot = await getRobinhoodTrending();
    return Response.json(snapshot, {
      status: 200,
      headers: { "Cache-Control": PUBLIC_CACHE },
    });
  } catch (error) {
    if (error instanceof GmgnTrendingError) {
      if (error.kind !== "not_configured") {
        console.error("[market/trending] GMGN request failed", {
          kind: error.kind,
          status: error.status,
          message: error.message,
        });
      }

      return Response.json(
        {
          error: {
            code:
              error.kind === "not_configured"
                ? "MARKET_FEED_NOT_CONFIGURED"
                : "MARKET_FEED_UNAVAILABLE",
            message:
              error.kind === "not_configured"
                ? "The Robinhood market feed is being configured."
                : "The Robinhood market feed is temporarily unavailable.",
          },
        },
        {
          status: error.status,
          headers: { "Cache-Control": NO_STORE },
        },
      );
    }

    console.error("[market/trending] Unexpected market feed failure", error);
    return Response.json(
      {
        error: {
          code: "MARKET_FEED_UNAVAILABLE",
          message: "The Robinhood market feed is temporarily unavailable.",
        },
      },
      {
        status: 500,
        headers: { "Cache-Control": NO_STORE },
      },
    );
  }
}
