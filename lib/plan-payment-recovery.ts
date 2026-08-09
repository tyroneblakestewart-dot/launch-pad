import type {
  PaidLaunchPath,
  PaymentBillingPeriod,
} from "@/lib/plan-payments";

export const RECOVERABLE_PLAN_PAYMENT_STORAGE_KEY = "hoodlums-recoverable-plan-payment-v1";

export type RecoverablePlanPayment = {
  version: 1;
  plan: PaidLaunchPath;
  billingPeriod: PaymentBillingPeriod;
  paymentToken: string;
  walletAddress: string;
  transactionHash: string;
  amountDisplay: string;
  chainId: number;
  createdAt: string;
  origin: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseRecoverablePlanPayment(
  value: string | null | undefined,
): RecoverablePlanPayment | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1) return null;
    if (
      typeof parsed.plan !== "string" ||
      typeof parsed.billingPeriod !== "string" ||
      typeof parsed.paymentToken !== "string" ||
      typeof parsed.walletAddress !== "string" ||
      typeof parsed.transactionHash !== "string" ||
      typeof parsed.amountDisplay !== "string" ||
      typeof parsed.chainId !== "number" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.origin !== "string"
    ) {
      return null;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(parsed.walletAddress)) return null;
    if (!/^0x[0-9a-fA-F]{64}$/.test(parsed.transactionHash)) return null;
    if (!Number.isSafeInteger(parsed.chainId) || parsed.chainId <= 0) return null;

    return parsed as RecoverablePlanPayment;
  } catch {
    return null;
  }
}

export function serialiseRecoverablePlanPayment(
  payment: RecoverablePlanPayment,
): string {
  return JSON.stringify(payment);
}
