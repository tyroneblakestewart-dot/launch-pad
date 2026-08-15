import { NextResponse } from "next/server";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { runSocialPostingCron } from "@/lib/server/social-posting-cron";

// Sends due, approved Social Studio posts to their connected destinations
// (issue #335), following app/api/cron/outreach/route.ts's pattern exactly:
// secret-gated, not publicly triggerable, service-isolation switch first.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const isolationResponse = await getServiceIsolationResponse("social-posting");
  if (isolationResponse) return isolationResponse;

  try {
    const result = await runSocialPostingCron();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Social posting cron run failed." },
      { status: 500 },
    );
  }
}
