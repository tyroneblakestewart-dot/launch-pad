import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

// Milestone A (issue #409) Part 4's "the tester's real bug today": this
// component's getProvider() prefers window.__launchpadEthereum (the exact
// provider AccountWalletBridge confirmed), but that in-memory reference only
// survives the page that confirmed it — a fresh load silently falls back to
// the bare window.ethereum, which can have a different active account with
// no warning before the launch signature is requested.
describe("studio launch modal wallet-mismatch guard (Milestone A, issue #409 Part 4)", () => {
  it("reuses the describeWalletMismatch pattern and the Account panel's confirmed-wallet storage", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain('import {\n  ACCOUNT_WALLET_STORAGE_KEY,\n  parseStoredAccountWallet,\n} from "@/lib/account-wallet-state";');
    expect(controller).toContain('import { describeWalletMismatch } from "@/lib/social-studio-queue";');
    expect(controller).toContain("localStorage.getItem(ACCOUNT_WALLET_STORAGE_KEY)");
    expect(controller).toContain("describeWalletMismatch(activeAccount, confirmedAccount)");
  });

  it("checks for a mismatch after resolving the active account but before requesting the deploy signature", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    const accountResolvedIndex = controller.indexOf("if (!account) throw new Error(\"The selected wallet returned no account.\");");
    const guardIndex = controller.indexOf("checkWalletMismatch(account)");
    const deployContractIndex = controller.indexOf("walletClient.deployContract({");
    expect(accountResolvedIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(accountResolvedIndex);
    expect(deployContractIndex).toBeGreaterThan(guardIndex);
  });

  it("offers explicit switch-wallet and continue-anyway choices naming the mismatched address", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain("Switch wallet");
    expect(controller).toContain("Continue anyway");
    expect(controller).toContain("continueWithMismatchedWallet");
  });

  it("resets the mismatch warning and bypass flag whenever the launch modal reattaches to a fresh project", async () => {
    const controller = await source("components/robinhood-testnet-deployment-controller.tsx");
    expect(controller).toContain("setMismatch(null);\n        setBypassMismatch(false);");
  });

  it("mirrors the panel's existing 560px mobile breakpoint (rule 7)", async () => {
    const css = await source("components/robinhood-testnet-deployment-controller.module.css");
    expect(css).toContain("@media (max-width: 560px)");
    expect(css).toContain(".mismatchActions {\n    grid-template-columns: 1fr;\n  }");
  });
});
