import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUEST_ALREADY_PENDING_CODE,
  USER_REJECTED_REQUEST_CODE,
  accountsFromPermissionGrant,
  describeWalletConnectError,
} from "../lib/wallet-connect-helpers";

async function source(...segments: string[]) {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

const ACCOUNT = "0x3990b0b29f08c1D415978E8EDB93aD00E5dC966a";
const OTHER = "0x505217CBbe3059993877983b4fDAD5C6e32AF1F5";

/**
 * MetaMask mobile could not connect from the Account panel (owner report,
 * 7 Sep 2026): the permission request succeeded and the follow-up
 * eth_requestAccounts failed with a plain-object rejection that the bridge
 * mislabelled "Wallet account selection was cancelled."
 */
describe("accountsFromPermissionGrant", () => {
  it("reads the accounts the user picked out of an EIP-2255 grant", () => {
    const grant = [
      { parentCapability: "endowment:permitted-chains", caveats: [{ type: "restrictNetworkSwitching", value: ["0xb626"] }] },
      { parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [ACCOUNT, OTHER] }] },
    ];
    expect(accountsFromPermissionGrant(grant)).toEqual([ACCOUNT, OTHER]);
  });

  it("returns [] for anything that is not a grant with real addresses", () => {
    expect(accountsFromPermissionGrant(null)).toEqual([]);
    expect(accountsFromPermissionGrant(undefined)).toEqual([]);
    expect(accountsFromPermissionGrant({})).toEqual([]);
    expect(accountsFromPermissionGrant([])).toEqual([]);
    expect(accountsFromPermissionGrant([{ parentCapability: "eth_accounts" }])).toEqual([]);
    expect(accountsFromPermissionGrant([{ parentCapability: "eth_accounts", caveats: [] }])).toEqual([]);
    expect(accountsFromPermissionGrant([{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: [] }] }])).toEqual([]);
    expect(accountsFromPermissionGrant([{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: ["not-an-address", 42] }] }])).toEqual([]);
    expect(accountsFromPermissionGrant([{ parentCapability: "eth_accounts", caveats: [{ type: "somethingElse", value: [ACCOUNT] }] }])).toEqual([]);
  });

  it("drops non-address entries but keeps the real ones", () => {
    const grant = [{ parentCapability: "eth_accounts", caveats: [{ type: "restrictReturnedAccounts", value: ["", ACCOUNT, null] }] }];
    expect(accountsFromPermissionGrant(grant)).toEqual([ACCOUNT]);
  });
});

describe("describeWalletConnectError", () => {
  it("only ever says 'cancelled' for a real 4001 rejection — Error or plain object alike", () => {
    expect(USER_REJECTED_REQUEST_CODE).toBe(4001);
    const plain = { code: 4001, message: "User rejected the request." };
    const asError = Object.assign(new Error("User rejected the request."), { code: 4001 });
    for (const error of [plain, asError]) {
      expect(describeWalletConnectError("MetaMask", error)).toBe(
        "MetaMask request was cancelled. Tap Connect again and approve it inside MetaMask.",
      );
    }
  });

  it("names an already-open wallet request instead of calling it a cancellation", () => {
    expect(REQUEST_ALREADY_PENDING_CODE).toBe(-32002);
    expect(describeWalletConnectError("MetaMask", { code: -32002, message: "Request of type 'wallet_requestPermissions' already pending" })).toBe(
      "MetaMask already has a request open. Open the MetaMask app, finish or dismiss it, then tap Connect again.",
    );
  });

  it("shows the wallet's own message for any other failure, whatever shape it arrives in", () => {
    expect(describeWalletConnectError("Rabby", { code: -32603, message: "Internal JSON-RPC error." })).toBe("Rabby: Internal JSON-RPC error.");
    expect(describeWalletConnectError("Phantom", new Error("Phantom is locked"))).toBe("Phantom: Phantom is locked");
    expect(describeWalletConnectError("MetaMask", "Something odd")).toBe("MetaMask: Something odd");
    // MetaMask sometimes nests the useful text under data.
    expect(describeWalletConnectError("MetaMask", { code: -32603, message: "", data: { originalError: { message: "Provider disconnected" } } })).toBe(
      "MetaMask: Provider disconnected",
    );
  });

  it("never blames the user when the wallet gave no reason at all", () => {
    for (const error of [undefined, null, {}, { code: -32000 }, ""]) {
      const text = describeWalletConnectError("MetaMask", error);
      expect(text).toBe("MetaMask did not complete the connection. Open the MetaMask app, then tap Connect again.");
      expect(text).not.toMatch(/cancel/i);
    }
  });
});

describe("account-wallet-bridge connect flow (source pins)", () => {
  it("takes the MetaMask accounts from the permission grant and never blindly prompts a second time", async () => {
    const bridge = await source("components", "account-wallet-bridge.tsx");
    expect(bridge).toContain('import { accountsFromPermissionGrant, describeWalletConnectError } from "@/lib/wallet-connect-helpers";');
    // The grant is captured, not discarded.
    expect(bridge).toContain("granted = await provider.request({\n        method: \"wallet_requestPermissions\",");
    expect(bridge).toContain("const chosen = accountsFromPermissionGrant(granted);\n      if (chosen.length > 0) return chosen;");
    // Then the silent read of what is now permitted, before any second prompt.
    expect(bridge).toContain('const permitted = (await provider.request({ method: "eth_accounts" })) as string[];');
    // The explicit prompt is still the last resort (and stays pinned by account-overlay.test.ts).
    expect(bridge).toContain('return (await provider.request({ method: "eth_requestAccounts" })) as string[];');
    expect(bridge.indexOf('method: "eth_accounts"')).toBeLessThan(bridge.indexOf('method: "eth_requestAccounts"'));
    // Wallets without wallet_requestPermissions still fall through as before.
    expect(bridge).toContain("const unsupported = providerError.code === -32601 || providerError.code === 4200;");
  });

  it("reports the wallet's real error and no longer invents a cancellation", async () => {
    const bridge = await source("components", "account-wallet-bridge.tsx");
    expect(bridge).toContain("setStatus(describeWalletConnectError(walletName, error));");
    expect(bridge).not.toContain("Wallet account selection was cancelled.");
    expect(bridge).not.toContain('error instanceof Error ? error.message : "Wallet');
  });
});
