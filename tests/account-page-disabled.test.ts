import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Account page connect controls", () => {
  it("keeps every provider and wallet option disabled and labelled as coming soon", async () => {
    const page = await readFile(path.join(ROOT, "app", "account", "page.tsx"), "utf8");

    expect(page).toContain("No sign-in");
    expect(page).toContain("provider is active in this first layout release.");

    const webAccountButtons = page.match(/webAccounts\.map[\s\S]*?<\/section>/)?.[0] ?? "";
    const walletButtons = page.match(/wallets\.map[\s\S]*?<\/section>/)?.[0] ?? "";

    for (const block of [webAccountButtons, walletButtons]) {
      expect(block).toContain("<button key={");
      expect(block).toContain("disabled>");
      expect(block).toContain("<em>Coming next</em>");
    }

    expect(page).not.toContain("onClick");
    expect(page).not.toContain("eth_requestAccounts");
    expect(page).not.toContain("window.ethereum");
  });

  it("does not wrap the page in a wallet-connect bridge that re-enables the disabled buttons", async () => {
    const bridgePath = path.join(ROOT, "components", "account-wallet-bridge.tsx");
    const layoutPath = path.join(ROOT, "app", "account", "layout.tsx");

    expect(existsSync(bridgePath)).toBe(false);
    expect(existsSync(layoutPath)).toBe(false);

    const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(
      "The `/account` route previews planned Google, GitHub, X, MetaMask, Rabby, and Phantom account options. These controls are currently disabled",
    );
  });
});
