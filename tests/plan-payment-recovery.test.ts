import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseRecoverablePlanPayment,
  serialiseRecoverablePlanPayment,
  type RecoverablePlanPayment,
} from "@/lib/plan-payment-recovery";

const ROOT = process.cwd();
const STRANDED_PRO_USDG_TX =
  "0xbff0d932de91d5ae449b2a1e0038f2ef6fa19488b9bd6445d0b5f0e717bb232a";

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("recoverable payment persistence", () => {
  const payment: RecoverablePlanPayment = {
    version: 1,
    plan: "pro",
    billingPeriod: "monthly",
    paymentToken: "USDG",
    walletAddress: "0x1111111111111111111111111111111111111111",
    transactionHash: STRANDED_PRO_USDG_TX,
    amountDisplay: "50",
    chainId: 4663,
    createdAt: "2026-08-08T00:30:00.000Z",
    origin: "https://hoodlums.dev",
  };

  it("round-trips the stranded Pro USDG recovery shape without persisting a wallet signature", () => {
    const serialised = serialiseRecoverablePlanPayment(payment);
    expect(parseRecoverablePlanPayment(serialised)).toEqual(payment);
    expect(serialised).toContain(STRANDED_PRO_USDG_TX);
    expect(serialised).not.toContain("signature");
  });

  it("rejects malformed transaction hashes and wallets", () => {
    expect(
      parseRecoverablePlanPayment(
        JSON.stringify({ ...payment, transactionHash: "0x1234" }),
      ),
    ).toBeNull();
    expect(
      parseRecoverablePlanPayment(
        JSON.stringify({ ...payment, walletAddress: "not-a-wallet" }),
      ),
    ).toBeNull();
  });
});

describe("payment recovery wiring", () => {
  it("uses a send-origin preflight before any eth_sendTransaction call", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const preflight = await source(
      "app",
      "api",
      "plan-payments",
      "preflight",
      "route.ts",
    );

    expect(preflight).toContain('getPlanPaymentOriginDecision(request, "send")');
    expect(checkout).toContain('fetch("/api/plan-payments/preflight"');
    expect(checkout).toContain("await ensureSendOriginAllowed()");
    expect(checkout.indexOf("await ensureSendOriginAllowed()")).toBeLessThan(
      checkout.indexOf('method: "eth_sendTransaction"'),
    );
    expect(checkout).toContain("disabled={!currentQuote || busy || !sendOriginAllowed}");
  });

  it("verification uses the payment-specific recovery-safe origin policy instead of admin origin rules", async () => {
    const route = await source(
      "app",
      "api",
      "plan-payments",
      "verify",
      "route.ts",
    );

    expect(route).toContain('getPlanPaymentOriginDecision(request, "verify")');
    expect(route).not.toContain("isAdminRequestOriginAllowed");
    expect(route).toContain("recoverable: true");
  });

  it("saves the tx hash immediately after send and before proof or verification", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const send = checkout.indexOf('method: "eth_sendTransaction"');
    const persist = checkout.indexOf(
      "persistRecoverablePayment(hash, walletAddress, currentQuote)",
      send,
    );
    const proof = checkout.indexOf(
      "requestWalletProof(provider, walletAddress, hash)",
      persist,
    );

    expect(send).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(send);
    expect(proof).toBeGreaterThan(persist);
    expect(checkout).toContain("Do not pay again. Your transaction is recoverable.");
  });

  it("can verify an existing tx hash without any second transaction send", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const start = checkout.indexOf("async function recoverExistingPayment()");
    const end = checkout.indexOf("async function pay()", start);
    const recovery = checkout.slice(start, end);

    expect(recovery).toContain("requestWalletProof");
    expect(recovery).toContain("finishVerification");
    expect(recovery).toContain("persistRecoverablePayment");
    expect(recovery).not.toContain('method: "eth_sendTransaction"');
    expect(checkout).toContain("VERIFY EXISTING PAYMENT — NO NEW TRANSFER");
  });

  it("reuses the full on-chain verifier and keeps one tx hash as one purchase", async () => {
    const server = await source("lib", "server", "plan-payments.ts");

    expect(server).toContain("if (!sameAddress(transaction.from, input.walletAddress))");
    expect(server).toContain("verifiedTokenTransfer({");
    expect(server).toContain("tokenAddress: quote.tokenAddress!");
    expect(server).toContain("treasuryAddress: quote.treasuryAddress");
    expect(server).toContain("expectedAmount: expectedAtomic");
    expect(server).toContain("ON CONFLICT (payment_tx_hash) DO NOTHING");
    expect(server).toContain("This transaction hash has already been used for another purchase or payment token.");
    expect(server).toContain('"replayed"');
  });
});
