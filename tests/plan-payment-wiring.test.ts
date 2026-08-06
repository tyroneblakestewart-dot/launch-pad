import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("shared plan purchase flow", () => {
  it("routes homepage cards and the New token chooser through one checkout implementation", async () => {
    const homepage = await source("components", "hoodlums-plans-section.tsx");
    const chooser = await source("components", "token-path-chooser.tsx");

    expect(homepage).toContain('requestWorkspaceOpen("new", path)');
    expect(homepage).not.toContain("eth_sendTransaction");
    expect(homepage).not.toContain("/api/plan-payments/verify");
    expect(chooser).toContain("<PlanCheckout");
    expect(chooser).toContain("if (isPaidLaunchPath(pending))");
  });

  it("keeps free plans direct and prevents paid confirmation before server verification", async () => {
    const chooser = await source("components", "token-path-chooser.tsx");
    const checkout = await source("components", "plan-checkout.tsx");

    expect(chooser).toContain("onConfirm(pending)");
    expect(chooser.indexOf("if (isPaidLaunchPath(pending))")).toBeLessThan(
      chooser.indexOf("onConfirm(pending)"),
    );
    expect(checkout).toContain('fetch("/api/plan-payments/verify"');
    expect(checkout).toContain("walletSignature");
    expect(checkout).toContain('if (result.destination === "builder")');
    expect(checkout).toContain("onBuilderUnlocked(plan)");
    expect(checkout.indexOf("verifyUntilConfirmed(walletAddress, hash, walletSignature)")).toBeLessThan(
      checkout.indexOf("onBuilderUnlocked(plan)"),
    );
  });

  it("offers monthly and 3-month subscription choices but keeps one-off plans one-off", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const catalog = await source("lib", "subscription-lifecycle.ts");

    expect(checkout).toContain("Monthly · 32 days");
    expect(checkout).toContain("3 months upfront · 96 days");
    expect(checkout).toContain('setBillingPeriod("monthly")');
    expect(checkout).toContain('setBillingPeriod("upfront")');
    expect(catalog).toContain('usdCents: 12_000, windowDays: 96');
    expect(catalog).toContain('usdCents: 28_800, windowDays: 96');
  });

  it("sends the server-supplied USDT token call rather than constructing payment details in the browser", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const config = await source("lib", "server", "plan-payment-config.ts");

    expect(checkout).toContain("to: quote.transactionTo");
    expect(checkout).toContain("value: quote.transactionValue");
    expect(checkout).toContain("data: quote.transactionData");
    expect(checkout).not.toContain("HOODLUMS_USDT_TOKEN_ADDRESS");
    expect(checkout).not.toContain("HOODLUMS_TREASURY_ADDRESS");
    expect(config).toContain('configuredAddress(environment, "HOODLUMS_USDT_TOKEN_ADDRESS")');
    expect(config).toContain("encodeFunctionData");
    expect(config).toContain('functionName: "transfer"');
  });

  it("retries the exact transaction hash without sending a second transaction", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const retryStart = checkout.indexOf(
      "if (transactionHash && paymentWalletAddress && paymentSignature)",
    );
    const retryEnd = checkout.indexOf("const browserWindow", retryStart);
    const retryBranch = checkout.slice(retryStart, retryEnd);

    expect(retryBranch).toContain("paymentWalletAddress");
    expect(retryBranch).toContain("transactionHash");
    expect(retryBranch).toContain("paymentSignature");
    expect(retryBranch).toContain("return;");
    expect(retryBranch).not.toContain("eth_sendTransaction");
    expect(checkout).toContain('method: "eth_sendTransaction"');
  });

  it("requires a wallet proof tied to payer, transaction, plan, billing period and origin", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const route = await source("app", "api", "plan-payments", "verify", "route.ts");
    const proof = await source("lib", "plan-payment-proof.ts");

    expect(checkout).toContain('method: "personal_sign"');
    expect(checkout).toContain("billingPeriod: quote.billingPeriod");
    expect(route).toContain("verifyPlanPaymentWalletProof");
    expect(route).toContain("billingPeriod");
    expect(route).toContain("walletSignature");
    expect(proof).toContain("`Billing: ${billingPeriod}`");
  });

  it("uses the exact selected EIP-6963 provider and a mobile-safe wallet button", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const css = await source("components", "plan-checkout.module.css");

    expect(checkout).toContain("browserWindow.__launchpadEthereum || browserWindow.ethereum");
    expect(checkout).toContain('needsWalletInteraction ? "wallet-button " : ""');
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain("grid-template-columns: 1fr;");
    expect(css).toContain("touch-action: manipulation;");
  });
});

describe("server verification and admin revenue standing rule", () => {
  it("requires decoded USDT calldata and a matching Transfer event before recording", async () => {
    const server = await source("lib", "server", "plan-payments.ts");

    expect(server).toContain("decodeFunctionData");
    expect(server).toContain("decodeEventLog");
    expect(server).toContain('event.eventName !== "Transfer"');
    expect(server).toContain("missing-transfer-log");
    expect(server).toContain("getTokenDecimals");
  });

  it("writes every verified payment to subscriptions, history and admin activity", async () => {
    const server = await source("lib", "server", "plan-payments.ts");
    const adminServer = await source("lib", "server", "admin-operations.ts");
    const adminMoney = await source("components", "admin-money-section.tsx");

    expect(server).toContain("INSERT INTO plan_payment_events");
    expect(server).toContain("INSERT INTO subscriptions");
    expect(server).toContain("payment-received");
    expect(adminServer).toContain("FROM plan_payment_events");
    expect(adminServer).toContain("asset_symbol");
    expect(adminMoney).toContain("Verified plan revenue");
    expect(adminMoney).toContain("Recent verified plan payments");
    expect(adminMoney).toContain("payment.amountDisplay");
    expect(adminMoney).toContain("payment.asset");
  });

  it("keeps all treasury, USDT and native price configuration server-only", async () => {
    const config = await source("lib", "server", "plan-payment-config.ts");
    const client = await source("components", "plan-checkout.tsx");

    expect(config).toContain('configuredAddress(environment, "HOODLUMS_TREASURY_ADDRESS")');
    expect(config).toContain('configuredAddress(environment, "HOODLUMS_USDT_TOKEN_ADDRESS")');
    expect(config).toContain("nativeAmountWeiEnvironmentKey");
    expect(client).not.toContain("HOODLUMS_TREASURY_ADDRESS");
    expect(client).not.toContain("HOODLUMS_USDT_TOKEN_ADDRESS");
    expect(client).not.toContain("HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI");
  });
});
