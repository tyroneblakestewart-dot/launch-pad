import type { PaidLaunchPath, PaymentBillingPeriod } from "@/lib/plan-payments";

export type PlanPaymentProofFields = {
  plan: PaidLaunchPath;
  billingPeriod: PaymentBillingPeriod;
  paymentToken?: string;
  walletAddress: string;
  transactionHash: string;
  origin: string;
};

export function buildPlanPaymentProofMessage({
  plan,
  billingPeriod,
  paymentToken,
  walletAddress,
  transactionHash,
  origin,
}: PlanPaymentProofFields): string {
  return [
    "HOODLUMS plan payment verification",
    `Origin: ${origin}`,
    `Plan: ${plan}`,
    `Billing: ${billingPeriod}`,
    `Wallet: ${walletAddress.toLowerCase()}`,
    `Transaction: ${transactionHash.toLowerCase()}`,
    `Token: ${paymentToken?.trim().toUpperCase() || "UNSPECIFIED"}`,
    "",
    "Signing confirms that you control the wallet that made this payment. It does not send another transaction.",
  ].join("\n");
}
