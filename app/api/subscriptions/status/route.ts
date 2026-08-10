import { NextResponse } from "next/server";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  getSubscriptionAccess,
  type SubscriptionQuery,
} from "@/lib/server/subscription-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet") || "";
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";

  if (!databaseUrl) {
    return NextResponse.json(
      { error: "Subscription status is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  let queryError: unknown = null;
  const pool = getPostgresPool(databaseUrl);
  const query = (async (text: string, params?: unknown[]) => {
    try {
      return await pool.query(text, params);
    } catch (error) {
      queryError = error;
      throw error;
    }
  }) as SubscriptionQuery;

  const access = await getSubscriptionAccess(wallet, { query });
  if (queryError) {
    console.error(
      "Subscription status lookup failed.",
      queryError instanceof Error ? (queryError.stack ?? queryError.message) : queryError,
    );
    return NextResponse.json(
      { error: "Subscription status is temporarily unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(access, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
