import { NextResponse } from "next/server";
import { runBuyBotCron } from "@/lib/server/buy-bot-cron";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

// Announces new curve buys for every active Buy Bot (owner direction, 5 Sep
// 2026), following app/api/cron/social-posting/route.ts's pattern exactly:
// secret-gated, not publicly triggerable, service-isolation switch first.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const isolationResponse = await getServiceIsolationResponse("buy-bot");
  if (isolationResponse) return isolationResponse;

  try {
    const result = await runBuyBotCron();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Buy Bot cron run failed." },
      { status: 500 },
    );
  }
}
