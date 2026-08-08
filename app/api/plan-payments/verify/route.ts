import { NextResponse } from "next/server";
import {
  isPaidLaunchPath,
  resolvePaymentBillingPeriod,
} from "@/lib/plan-payments";
import {
  getPlanPaymentQuote,
  PlanPaymentConfigurationError,
} from "@/lib/server/plan-payment-config";
import { getPlanPaymentOriginDecision } from "@/lib/server/plan-payment-origin";
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
  const originDecision = getPlanPaymentOriginDecision(request, "verify");
  if (!originDecision.allowed) {
    return NextResponse.json(
      {
        error: originDecision.reason,
        recoveryOrigin: originDecision.primaryOrigin,
        recoverable: true,
      },
      {
        status: 403,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
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
      origin: originDecision.requestOrigin!,
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
      return NextResponse.json(
        { error: error.message, recoverable: true },
        { status: 401 },
      );
    }
    if (error instanceof PlanPaymentConfigurationError) {
      return NextResponse.json(
        { error: error.message, recoverable: true },
        { status: 503 },
      );
    }
    if (error instanceof PlanPaymentError) {
      if (error.code === "pending") {
        return NextResponse.json(
          { pending: true, recoverable: true, error: error.message },
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
      return NextResponse.json(
        { error: error.message, recoverable: error.code !== "replayed" },
        { status },
      );
    }
    return NextResponse.json(
      {
        error:
          "Payment verification failed safely. The transaction hash remains recoverable and no second payment is required.",
        recoverable: true,
      },
      { status: 500 },
    );
  }
}
