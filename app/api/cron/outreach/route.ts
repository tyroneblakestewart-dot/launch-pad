import { NextResponse } from "next/server";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";
import { runOutreachCron } from "@/lib/server/outreach-cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const isolationResponse = await getServiceIsolationResponse("outreach");
  if (isolationResponse) return isolationResponse;

  try {
    const result = await runOutreachCron();
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Outreach cron run failed.",
      },
      { status: 500 },
    );
  }
}
