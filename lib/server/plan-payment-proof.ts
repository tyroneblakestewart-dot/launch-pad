import {
  isAddress,
  isHex,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { buildPlanPaymentProofMessage } from "@/lib/plan-payment-proof";
import type { PaidLaunchPath } from "@/lib/plan-payments";

export class PlanPaymentProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPaymentProofError";
  }
}

export type VerifyPlanPaymentProofInput = {
  plan: PaidLaunchPath;
  walletAddress: string;
  transactionHash: string;
  walletSignature: string;
  origin: string;
};

type MessageVerifier = (input: {
  address: Address;
  message: string;
  signature: Hex;
}) => Promise<boolean>;

export async function verifyPlanPaymentWalletProof(
  input: VerifyPlanPaymentProofInput,
  verifier: MessageVerifier = verifyMessage,
): Promise<void> {
  if (!isAddress(input.walletAddress) || !isHex(input.walletSignature)) {
    throw new PlanPaymentProofError(
      "A valid paying wallet and wallet signature are required.",
    );
  }

  let origin: string;
  try {
    origin = new URL(input.origin).origin;
  } catch {
    throw new PlanPaymentProofError("The payment proof origin is invalid.");
  }

  const valid = await verifier({
    address: input.walletAddress,
    message: buildPlanPaymentProofMessage({
      plan: input.plan,
      walletAddress: input.walletAddress,
      transactionHash: input.transactionHash,
      origin,
    }),
    signature: input.walletSignature,
  });

  if (!valid) {
    throw new PlanPaymentProofError(
      "The wallet signature does not match the wallet that made the payment.",
    );
  }
}
