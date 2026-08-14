import { NextResponse } from "next/server";
import { isPaidLaunchPath } from "@/lib/plan-payments";
import {
  getPlanPaymentQuote,
  PlanPaymentConfigurationError,
} from "@/lib/server/plan-payment-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

function paymentsNotConfigured(reason: string) {
  console.error(`Plan payment configuration is incomplete: ${reason}`);
  return NextResponse.json(
    {
      code: "payments-not-configured",
      error: "Payments are not configured for this plan on this deployment.",
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = url.searchParams.get("plan");
  const billing = url.searchParams.get("billing");
  const paymentToken = url.searchParams.get("token");
  if (!isPaidLaunchPath(plan)) {
    return NextResponse.json(
      { error: "Unknown paid plan." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return paymentsNotConfigured("DATABASE_URL is not configured.");
  }

  try {
    return NextResponse.json(getPlanPaymentQuote(plan, billing, paymentToken), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return paymentsNotConfigured(
      error instanceof PlanPaymentConfigurationError
        ? error.message
        : "Plan payment configuration could not be resolved.",
    );
  }
}
