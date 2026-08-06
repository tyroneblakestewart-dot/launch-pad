import type { PaidLaunchPath } from "@/lib/plan-payments";

export type PlanPaymentProofFields = {
  plan: PaidLaunchPath;
  walletAddress: string;
  transactionHash: string;
  origin: string;
};

export function buildPlanPaymentProofMessage({
  plan,
  walletAddress,
  transactionHash,
  origin,
}: PlanPaymentProofFields): string {
  return [
    "HOODLUMS plan payment verification",
    `Origin: ${origin}`,
    `Plan: ${plan}`,
    `Wallet: ${walletAddress.toLowerCase()}`,
    `Transaction: ${transactionHash.toLowerCase()}`,
    "",
    "Signing confirms that you control the wallet that made this payment. It does not send another transaction.",
  ].join("\n");
}
