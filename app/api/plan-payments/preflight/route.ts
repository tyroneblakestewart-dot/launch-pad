import { NextResponse } from "next/server";
import { getPlanPaymentOriginDecision } from "@/lib/server/plan-payment-origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const decision = getPlanPaymentOriginDecision(request);
  if (!decision.allowed) {
    return NextResponse.json(
      {
        allowed: false,
        error: decision.reason,
        recoveryOrigin: decision.primaryOrigin,
      },
      {
        status: 403,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      allowed: true,
      origin: decision.requestOrigin,
      recoveryOrigin: decision.primaryOrigin,
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
