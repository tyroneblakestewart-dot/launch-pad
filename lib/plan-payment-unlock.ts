import { isAddress, isHash } from "viem";
import {
  isPaidLaunchPath,
  planPaymentDefinition,
  type PaidLaunchPath,
  type PaymentBillingPeriod,
  type PlanPaymentVerification,
} from "@/lib/plan-payments";

export type ExpectedPlanPaymentVerification = {
  plan: PaidLaunchPath;
  billingPeriod: PaymentBillingPeriod;
  walletAddress: string;
  transactionHash: string;
};

const SUBSCRIPTION_STATUSES = new Set(["active", "expiring", "expired"]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function sameValue(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Treat the successful verify API payload as untrusted until every field that
 * controls access matches the request that produced it. A local plan id,
 * saved-project value or session flag can never satisfy this function.
 */
export function requireServerVerifiedPlanPayment(
  value: unknown,
  expected: ExpectedPlanPaymentVerification,
): PlanPaymentVerification {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The payment verification response was invalid.");
  }

  const result = value as Record<string, unknown>;
  if (
    result.verified !== true ||
    !isPaidLaunchPath(result.plan) ||
    result.plan !== expected.plan ||
    result.billingPeriod !== expected.billingPeriod ||
    result.destination !== planPaymentDefinition(expected.plan).destination ||
    typeof result.walletAddress !== "string" ||
    !isAddress(result.walletAddress) ||
    !sameValue(result.walletAddress, expected.walletAddress) ||
    typeof result.transactionHash !== "string" ||
    !isHash(result.transactionHash) ||
    !sameValue(result.transactionHash, expected.transactionHash) ||
    typeof result.asset !== "string" ||
    result.asset.trim().length === 0 ||
    typeof result.amountDisplay !== "string" ||
    result.amountDisplay.trim().length === 0 ||
    !isNullableString(result.amountEth) ||
    typeof result.usdCents !== "number" ||
    !Number.isSafeInteger(result.usdCents) ||
    result.usdCents <= 0 ||
    !isNullableString(result.paidFrom) ||
    !isNullableString(result.paidUntil) ||
    !(
      result.subscriptionStatus === null ||
      (typeof result.subscriptionStatus === "string" &&
        SUBSCRIPTION_STATUSES.has(result.subscriptionStatus))
    ) ||
    typeof result.alreadyRecorded !== "boolean" ||
    !isNullableString(result.telegramLinkUrl)
  ) {
    throw new Error(
      "The payment verification response did not match the requested plan, wallet and transaction.",
    );
  }

  return result as PlanPaymentVerification;
}

export function isServerVerifiedBuilderPayment(
  value: unknown,
  expectedPlan: PaidLaunchPath,
): value is PlanPaymentVerification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<PlanPaymentVerification>;
  return (
    result.verified === true &&
    result.plan === expectedPlan &&
    result.destination === "builder" &&
    result.billingPeriod === "one_off" &&
    typeof result.walletAddress === "string" &&
    isAddress(result.walletAddress) &&
    typeof result.transactionHash === "string" &&
    isHash(result.transactionHash)
  );
}

export type PlanBuilderUnlockGuard = {
  consume: (
    verification: unknown,
    expectedPlan: PaidLaunchPath,
  ) => PaidLaunchPath | null;
  reset: () => void;
};

/** Allows one builder unlock per checkout attempt, and only from a verified server payload. */
export function createPlanBuilderUnlockGuard(): PlanBuilderUnlockGuard {
  let consumed = false;

  return {
    consume(verification, expectedPlan) {
      if (consumed || !isServerVerifiedBuilderPayment(verification, expectedPlan)) {
        return null;
      }
      consumed = true;
      return verification.plan;
    },
    reset() {
      consumed = false;
    },
  };
}
