import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { buildPlanPaymentProofMessage } from "@/lib/plan-payment-proof";
import {
  PlanPaymentProofError,
  verifyPlanPaymentWalletProof,
} from "@/lib/server/plan-payment-proof";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;
const HASH = `0x${"ab".repeat(32)}`;
const SIGNATURE = `0x${"cd".repeat(65)}` as Hex;
const ORIGIN = "https://hoodlums.dev";

describe("plan payment wallet proof", () => {
  it("binds the signature to origin, plan, billing period, wallet and transaction", () => {
    expect(
      buildPlanPaymentProofMessage({
        plan: "pro-bundle",
        billingPeriod: "upfront",
        walletAddress: WALLET,
        transactionHash: HASH,
        origin: ORIGIN,
      }),
    ).toContain(
      [
        "Origin: https://hoodlums.dev",
        "Plan: pro-bundle",
        "Billing: upfront",
        `Wallet: ${WALLET}`,
        `Transaction: ${HASH}`,
      ].join("\n"),
    );
  });

  it("passes the exact bound message to viem verification", async () => {
    const verifier = vi.fn(async () => true);

    await verifyPlanPaymentWalletProof(
      {
        plan: "pro",
        billingPeriod: "monthly",
        walletAddress: WALLET,
        transactionHash: HASH,
        walletSignature: SIGNATURE,
        origin: `${ORIGIN}/ignored-path`,
      },
      verifier,
    );

    expect(verifier).toHaveBeenCalledWith({
      address: WALLET,
      signature: SIGNATURE,
      message: buildPlanPaymentProofMessage({
        plan: "pro",
        billingPeriod: "monthly",
        walletAddress: WALLET,
        transactionHash: HASH,
        origin: ORIGIN,
      }),
    });
  });

  it("prevents a monthly proof from being reused for an upfront purchase", () => {
    const monthly = buildPlanPaymentProofMessage({
      plan: "pro",
      billingPeriod: "monthly",
      walletAddress: WALLET,
      transactionHash: HASH,
      origin: ORIGIN,
    });
    const upfront = buildPlanPaymentProofMessage({
      plan: "pro",
      billingPeriod: "upfront",
      walletAddress: WALLET,
      transactionHash: HASH,
      origin: ORIGIN,
    });
    expect(monthly).not.toBe(upfront);
  });

  it("rejects a signature that does not recover to the paying wallet", async () => {
    await expect(
      verifyPlanPaymentWalletProof(
        {
          plan: "bond-pro-site",
          billingPeriod: "one_off",
          walletAddress: WALLET,
          transactionHash: HASH,
          walletSignature: SIGNATURE,
          origin: ORIGIN,
        },
        async () => false,
      ),
    ).rejects.toBeInstanceOf(PlanPaymentProofError);
  });

  it("rejects malformed wallet or signature values before chain verification", async () => {
    await expect(
      verifyPlanPaymentWalletProof({
        plan: "pro",
        billingPeriod: "monthly",
        walletAddress: "not-an-address",
        transactionHash: HASH,
        walletSignature: "not-a-signature",
        origin: ORIGIN,
      }),
    ).rejects.toThrow("valid paying wallet and wallet signature");
  });
});
