import { NextResponse } from "next/server";
import {
  isPaidLaunchPath,
  resolvePaymentBillingPeriod,
} from "@/lib/plan-payments";
import { isAdminRequestOriginAllowed } from "@/lib/server/api-protection";
import {
  getPlanPaymentQuote,
  PlanPaymentConfigurationError,
} from "@/lib/server/plan-payment-config";
import {
  PlanPaymentProofError,
  verifyPlanPaymentWalletProof,
} from "@/lib/server/plan-payment-proof";
import {
  PlanPaymentError,
  verifyAndRecordPlanPayment,
} from "@/lib/server/plan-payments";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAdminRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = body as {
    plan?: unknown;
    billingPeriod?: unknown;
    paymentToken?: unknown;
    walletAddress?: unknown;
    transactionHash?: unknown;
    walletSignature?: unknown;
  };
  if (
    !isPaidLaunchPath(input.plan) ||
    (input.paymentToken !== undefined && typeof input.paymentToken !== "string") ||
    typeof input.walletAddress !== "string" ||
    typeof input.transactionHash !== "string" ||
    typeof input.walletSignature !== "string"
  ) {
    return NextResponse.json(
      {
        error:
          "Plan, walletAddress, transactionHash and walletSignature are required; paymentToken must be a string when supplied.",
      },
      { status: 400 },
    );
  }

  const billingPeriod = resolvePaymentBillingPeriod(input.plan, input.billingPeriod);

  try {
    const quote = getPlanPaymentQuote(
      input.plan,
      billingPeriod,
      input.paymentToken,
    );

    await verifyPlanPaymentWalletProof({
      plan: input.plan,
      billingPeriod,
      paymentToken: quote.asset,
      walletAddress: input.walletAddress,
      transactionHash: input.transactionHash,
      walletSignature: input.walletSignature,
      origin: new URL(request.url).origin,
    });

    const result = await verifyAndRecordPlanPayment({
      plan: input.plan,
      billingPeriod,
      paymentToken: quote.asset,
      walletAddress: input.walletAddress,
      transactionHash: input.transactionHash,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof PlanPaymentProofError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof PlanPaymentConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof PlanPaymentError) {
      if (error.code === "pending") {
        return NextResponse.json(
          { pending: true, error: error.message },
          { status: 202 },
        );
      }
      const status =
        error.code === "database-unavailable"
          ? 503
          : error.code === "replayed"
            ? 409
            : error.code === "invalid-request"
              ? 400
              : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: "Payment verification failed safely. No plan was unlocked." },
      { status: 500 },
    );
  }
}
