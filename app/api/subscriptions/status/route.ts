import { NextResponse } from "next/server";
import { getSubscriptionAccess } from "@/lib/server/subscription-lifecycle";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const wallet = new URL(request.url).searchParams.get("wallet") || "";
  const access = await getSubscriptionAccess(wallet);
  return NextResponse.json(access, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
