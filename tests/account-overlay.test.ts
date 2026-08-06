import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseStoredAccountWallet,
  truncateAccountAddress,
} from "@/lib/account-wallet-state";

const ROOT = process.cwd();

async function source(...parts: string[]) {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Account overlay restructure", () => {
  it("removes Account from the launch-flow sidebar and mobile navigation header", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    const css = await source("components", "app-navigation.module.css");

    expect(navigation).not.toContain('href="/account"');
    expect(navigation).not.toContain("accountLink");
    expect(navigation).not.toContain("accountButton");
    expect(css).not.toContain(".accountLink");
    expect(css).not.toContain(".accountButton");
  });

  it("mounts one persistent account overlay across the app shell and standalone token pages", async () => {
    const appLayout = await source("app", "(app)", "layout.tsx");
    const tokenLayout = await source("app", "token", "[chain]", "[address]", "layout.tsx");

    expect(appLayout).toContain('import { AccountOverlayShell } from "@/components/account-overlay-shell"');
    expect(appLayout).toContain("<AccountOverlayShell />");
    expect(tokenLayout).toContain("<AccountOverlayShell />");
  });

  it("shows Account when disconnected and a green-dot truncated address when connected", async () => {
    const overlay = await source("components", "account-overlay.tsx");
    const css = await source("components", "account-overlay.module.css");

    expect(overlay).toContain('"Account"');
    expect(overlay).toContain("styles.connectedDot");
    expect(overlay).toContain("truncateAccountAddress(wallet.account)");
    expect(css).toContain(".connectedDot {");
    expect(css).toContain("background: #c6f53e;");
  });

  it("keeps the current sign-in and wallet choices inside a modal overlay", async () => {
    const overlay = await source("components", "account-overlay.tsx");

    for (const provider of ["Google", "GitHub", "X", "MetaMask", "Rabby", "Phantom"]) {
      expect(overlay).toContain(provider);
    }
    expect(overlay).toContain("Coming next");
    expect(overlay).toContain("<AccountWalletBridge embedded />");
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
  });

  it("opens from the redirected account query and preserves CMS preview support", async () => {
    const overlay = await source("components", "account-overlay.tsx");
    const config = await source("next.config.ts");
    const route = await source("app", "api", "account-content", "route.ts");

    expect(config).toContain('source: "/account"');
    expect(config).toContain('destination: "/?account=open"');
    expect(overlay).toContain('params.get("account") === "open"');
    expect(overlay).toContain('fetch("/api/account-content?cms_preview=1"');
    expect(route).toContain('resolvePageContent(\n    "account"');
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });

  it("keeps the existing exact-provider wallet connection flow and announces account-state changes", async () => {
    const bridge = await source("components", "account-wallet-bridge.tsx");

    expect(bridge).toContain('window.addEventListener("eip6963:announceProvider"');
    expect(bridge).toContain('window.dispatchEvent(new Event("eip6963:requestProvider"))');
    expect(bridge).toContain('method: "wallet_requestPermissions"');
    expect(bridge).toContain('method: "eth_requestAccounts"');
    expect(bridge).toContain("ACCOUNT_WALLET_STORAGE_KEY");
    expect(bridge).toContain("ACCOUNT_WALLET_CHANGE_EVENT");
    expect(bridge).toContain("notifyAccountWalletChange()");
  });

  it("fits the modal into a 390px iPhone Safari viewport", async () => {
    const css = await source("components", "account-overlay.module.css");

    expect(css).toContain("@media (max-width: 390px)");
    expect(css).toContain("max-height: calc(100dvh - 20px - env(safe-area-inset-top));");
    expect(css).toContain("padding-bottom: max(10px, env(safe-area-inset-bottom));");
    expect(css).toContain("-webkit-overflow-scrolling: touch;");
    expect(css).toContain("touch-action: manipulation;");
  });
});

describe("account wallet state", () => {
  it("parses the confirmed wallet and formats the requested address shape", () => {
    expect(
      parseStoredAccountWallet(
        JSON.stringify({ walletName: "Rabby", account: "0x1234567890abcdef5678" }),
      ),
    ).toEqual({ walletName: "Rabby", account: "0x1234567890abcdef5678" });
    expect(truncateAccountAddress("0x1234567890abcdef5678")).toBe("0x1234...5678");
  });

  it("rejects corrupt or incomplete stored account state", () => {
    expect(parseStoredAccountWallet(null)).toBeNull();
    expect(parseStoredAccountWallet("not-json")).toBeNull();
    expect(parseStoredAccountWallet(JSON.stringify({ walletName: "MetaMask" }))).toBeNull();
  });
});
