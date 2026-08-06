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

  it("offers monthly, upfront and server-supplied stablecoin choices", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const catalog = await source("lib", "subscription-lifecycle.ts");

    expect(checkout).toContain("Monthly · 32 days");
    expect(checkout).toContain("3 months upfront · 96 days");
    expect(checkout).toContain('changeBillingPeriod("monthly")');
    expect(checkout).toContain('changeBillingPeriod("upfront")');
    expect(checkout).toContain("currentQuote.paymentTokens.map");
    expect(checkout).toContain("changePaymentToken(token.symbol)");
    expect(checkout).toContain("Pay with {token.symbol}");
    expect(catalog).toContain('usdCents: 12_000, windowDays: 96');
    expect(catalog).toContain('usdCents: 28_800, windowDays: 96');
  });

  it("sends only the server-supplied transaction rather than constructing payment details in the browser", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const config = await source("lib", "server", "plan-payment-config.ts");

    expect(checkout).toContain("to: currentQuote.transactionTo");
    expect(checkout).toContain("value: currentQuote.transactionValue");
    expect(checkout).toContain("data: currentQuote.transactionData");
    expect(checkout).not.toContain("HOODLUMS_PAYMENT_TOKENS_JSON");
    expect(checkout).not.toContain("HOODLUMS_TREASURY_ADDRESS");
    expect(config).toContain("HOODLUMS_PAYMENT_TOKENS_JSON");
    expect(config).toContain("getEnabledPaymentTokenOptions");
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

  it("binds the wallet proof to payer, transaction, plan, billing period, token and origin", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const route = await source("app", "api", "plan-payments", "verify", "route.ts");
    const proof = await source("lib", "plan-payment-proof.ts");

    expect(checkout).toContain('method: "personal_sign"');
    expect(checkout).toContain("billingPeriod: currentQuote.billingPeriod");
    expect(checkout).toContain("paymentToken: currentQuote.asset");
    expect(route).toContain("verifyPlanPaymentWalletProof");
    expect(route).toContain("paymentToken: quote.asset");
    expect(proof).toContain("`Billing: ${billingPeriod}`");
    expect(proof).toContain("`Token: ${paymentToken");
  });

  it("resets quote state from selection handlers rather than synchronously inside the fetch effect", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const effectStart = checkout.indexOf("useEffect(() => {");
    const effectEnd = checkout.indexOf("function resetForSelection", effectStart);
    const effect = checkout.slice(effectStart, effectEnd);
    const handlers = checkout.slice(
      effectEnd,
      checkout.indexOf("async function requestWalletProof"),
    );

    expect(effect).not.toContain("setQuote(null)");
    expect(effect).not.toContain('setPhase("loading")');
    expect(handlers).toContain("setQuote(null)");
    expect(handlers).toContain('setPhase("loading")');
    expect(handlers).toContain("setPaymentToken(nextToken)");
    expect(checkout).toContain("quote?.plan === plan");
    expect(checkout).toContain("quote.billingPeriod === expectedBilling");
    expect(checkout).toContain("quote.asset === paymentToken");
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
  it("requires decoded selected-token calldata and a matching Transfer event before recording", async () => {
    const server = await source("lib", "server", "plan-payments.ts");

    expect(server).toContain("decodeFunctionData");
    expect(server).toContain("decodeEventLog");
    expect(server).toContain('event.eventName !== "Transfer"');
    expect(server).toContain("missing-transfer-log");
    expect(server).toContain("getTokenDecimals");
    expect(server).toContain("symbol: quote.asset");
  });

  it("writes every verified payment to subscriptions, history and admin activity", async () => {
    const server = await source("lib", "server", "plan-payments.ts");
    const adminServer = await source("lib", "server", "admin-operations.ts");
    const adminMoney = await source("components", "admin-money-section.tsx");

    expect(server).toContain("INSERT INTO plan_payment_events");
    expect(server).toContain("asset_symbol");
    expect(server).toContain("asset_contract");
    expect(server).toContain("INSERT INTO subscriptions");
    expect(server).toContain("payment-received");
    expect(adminServer).toContain("FROM plan_payment_events");
    expect(adminServer).toContain("asset_symbol");
    expect(adminMoney).toContain("Verified plan revenue");
    expect(adminMoney).toContain("Recent verified plan payments");
    expect(adminMoney).toContain("payment.amountDisplay");
    expect(adminMoney).toContain("payment.asset");
  });

  it("keeps treasury, token catalog and native price configuration server-only", async () => {
    const config = await source("lib", "server", "plan-payment-config.ts");
    const client = await source("components", "plan-checkout.tsx");

    expect(config).toContain('configuredAddress(environment, "HOODLUMS_TREASURY_ADDRESS")');
    expect(config).toContain("HOODLUMS_PAYMENT_TOKENS_JSON");
    expect(config).toContain("nativeAmountWeiEnvironmentKey");
    expect(client).not.toContain("HOODLUMS_TREASURY_ADDRESS");
    expect(client).not.toContain("HOODLUMS_PAYMENT_TOKENS_JSON");
    expect(client).not.toContain("HOODLUMS_BOND_PRO_SITE_AMOUNT_WEI");
  });
});
