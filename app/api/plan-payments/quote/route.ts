import { NextResponse } from "next/server";
import { isPaidLaunchPath } from "@/lib/plan-payments";
import {
  getPlanPaymentQuote,
  PlanPaymentConfigurationError,
} from "@/lib/server/plan-payment-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan");
  const billing = url.searchParams.get("billing");
  if (!isPaidLaunchPath(plan)) {
    return NextResponse.json({ error: "Unknown paid plan." }, { status: 400 });
  }

  try {
    return NextResponse.json(getPlanPaymentQuote(plan, billing), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const message =
      error instanceof PlanPaymentConfigurationError
        ? error.message
        : "Plan payments are not configured.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
