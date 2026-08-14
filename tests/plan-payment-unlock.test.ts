import { describe, expect, it, vi } from "vitest";
import {
  createPlanBuilderUnlockGuard,
  requireServerVerifiedPlanPayment,
} from "@/lib/plan-payment-unlock";
import type { PlanPaymentVerification } from "@/lib/plan-payments";

const WALLET = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"ab".repeat(32)}`;

const VERIFIED_PAYMENT: PlanPaymentVerification = {
  verified: true,
  plan: "bond-pro-site",
  billingPeriod: "one_off",
  walletAddress: WALLET,
  transactionHash: HASH,
  asset: "ETH",
  amountDisplay: "0.01",
  amountEth: "0.01",
  usdCents: 1_000,
  paidFrom: null,
  paidUntil: null,
  subscriptionStatus: "active",
  destination: "builder",
  alreadyRecorded: false,
  telegramLinkUrl: null,
};

const EXPECTED = {
  plan: "bond-pro-site" as const,
  billingPeriod: "one_off" as const,
  walletAddress: WALLET,
  transactionHash: HASH,
};

describe("Bond + Pro Site server-verified unlock", () => {
  it("rejects client/session flags and mismatched verification payloads", () => {
    const guard = createPlanBuilderUnlockGuard();

    expect(
      guard.consume(
        { verified: true, plan: "bond-pro-site", destination: "builder" },
        "bond-pro-site",
      ),
    ).toBeNull();

    expect(() =>
      requireServerVerifiedPlanPayment(
        { ...VERIFIED_PAYMENT, walletAddress: "0x2222222222222222222222222222222222222222" },
        EXPECTED,
      ),
    ).toThrow(/did not match the requested plan, wallet and transaction/i);
  });

  it("unlocks exactly once from a mocked successful verify API response", async () => {
    const verifyApi = vi.fn(async () =>
      new Response(JSON.stringify(VERIFIED_PAYMENT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const guard = createPlanBuilderUnlockGuard();
    const onConfirm = vi.fn();

    async function attemptUnlock() {
      const response = await verifyApi();
      const verification = requireServerVerifiedPlanPayment(
        await response.json(),
        EXPECTED,
      );
      const plan = guard.consume(verification, "bond-pro-site");
      if (plan) onConfirm(plan);
    }

    await attemptUnlock();
    await attemptUnlock();

    expect(verifyApi).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("bond-pro-site");
  });
});
