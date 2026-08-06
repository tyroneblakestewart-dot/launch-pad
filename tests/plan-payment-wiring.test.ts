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
    expect(checkout).toContain('if (result.destination === "builder")');
    expect(checkout).toContain("onBuilderUnlocked(plan)");
    expect(checkout.indexOf("verifyUntilConfirmed(walletAddress, hash)")).toBeLessThan(
      checkout.indexOf("onBuilderUnlocked(plan)"),
    );
  });

  it("retries the exact transaction hash without sending a second transaction", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const retryBranch = checkout.slice(
      checkout.indexOf("if (transactionHash && paymentWalletAddress)"),
      checkout.indexOf('setPhase("sending")'),
    );

    expect(retryBranch).toContain("finishVerification(paymentWalletAddress, transactionHash)");
    expect(retryBranch).toContain("return;");
    expect(retryBranch).not.toContain("eth_sendTransaction");
    expect(checkout).toContain('method: "eth_sendTransaction"');
  });

  it("uses the exact selected EIP-6963 provider and a mobile-safe wallet button", async () => {
    const checkout = await source("components", "plan-checkout.tsx");
    const css = await source("components", "plan-checkout.module.css");

    expect(checkout).toContain("browserWindow.__launchpadEthereum || browserWindow.ethereum");
    expect(checkout).toContain('className={`wallet-button ${styles.payButton}`}');
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain("grid-template-columns: 1fr;");
    expect(css).toContain("touch-action: manipulation;");
  });
});

describe("admin revenue standing rule", () => {
  it("writes each verified payment to subscriptions, the payment ledger and admin activity", async () => {
    const server = await source("lib", "server", "plan-payments.ts");
    const adminServer = await source("lib", "server", "admin-operations.ts");
    const adminUi = await source("components", "admin-operations-sections.tsx");

    expect(server).toContain("INSERT INTO plan_payment_events");
    expect(server).toContain("INSERT INTO subscriptions");
    expect(server).toContain("payment-received");
    expect(adminServer).toContain("FROM plan_payment_events");
    expect(adminUi).toContain("Verified plan revenue");
    expect(adminUi).toContain("Recent verified plan payments");
  });

  it("keeps the treasury and ETH price configuration server-only", async () => {
    const config = await source("lib", "server", "plan-payment-config.ts");
    const client = await source("components", "plan-checkout.tsx");

    expect(config).toContain('required(environment, "HOODLUMS_TREASURY_ADDRESS")');
    expect(config).toContain("amountWeiEnvironmentKey");
    expect(client).not.toContain("HOODLUMS_TREASURY_ADDRESS");
    expect(client).not.toContain("HOODLUMS_PRO_AMOUNT_WEI");
  });
});
