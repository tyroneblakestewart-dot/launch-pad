import { describe, expect, it } from "vitest";
import {
  ERC20_MIN_ABI,
  HOODLUMS_BONDING_CURVE_FEES_ABI,
  HOODLUMS_BONDING_CURVE_TRADE_ABI,
} from "../lib/bonding-curve-config";

type AbiItemShape = { type: string; name?: string; stateMutability?: string };

describe("HOODLUMS_BONDING_CURVE_TRADE_ABI", () => {
  const items = HOODLUMS_BONDING_CURVE_TRADE_ABI as unknown as readonly AbiItemShape[];

  it("exposes token identity, quoting, the graduation clamp read and trading — kept separate from the read-only graduation-status ABI", () => {
    const names = items.filter((item) => item.type === "function").map((item) => item.name).sort();
    expect(names).toEqual(
      ["buy", "quoteBuy", "quoteSell", "quoteSellFee", "remainingNativeToGraduate", "sell", "token"].sort(),
    );
  });

  it("marks buy() and sell() as payable/nonpayable, not view — they are wallet-signed transactions", () => {
    const buy = items.find((item) => item.name === "buy");
    const sell = items.find((item) => item.name === "sell");
    expect(buy?.stateMutability).toBe("payable");
    expect(sell?.stateMutability).toBe("nonpayable");
  });

  it("keeps every quote/read function as a view — token, quoteBuy, quoteSell, quoteSellFee, remainingNativeToGraduate", () => {
    for (const name of ["token", "quoteBuy", "quoteSell", "quoteSellFee", "remainingNativeToGraduate"]) {
      expect(items.find((item) => item.name === name)?.stateMutability).toBe("view");
    }
  });
});

describe("HOODLUMS_BONDING_CURVE_FEES_ABI", () => {
  const items = HOODLUMS_BONDING_CURVE_FEES_ABI as unknown as readonly AbiItemShape[];

  it("exposes exactly creator, claimableFees and withdrawFees — the creator fee panel's needs (issue #412 Part 2)", () => {
    const names = items.filter((item) => item.type === "function").map((item) => item.name).sort();
    expect(names).toEqual(["creator", "claimableFees", "withdrawFees"].sort());
  });

  it("marks creator/claimableFees as view reads and withdrawFees as a wallet-signed transaction", () => {
    expect(items.find((item) => item.name === "creator")?.stateMutability).toBe("view");
    expect(items.find((item) => item.name === "claimableFees")?.stateMutability).toBe("view");
    expect(items.find((item) => item.name === "withdrawFees")?.stateMutability).toBe("nonpayable");
  });
});

describe("ERC20_MIN_ABI", () => {
  const items = ERC20_MIN_ABI as unknown as readonly AbiItemShape[];

  it("exposes exactly allowance, approve and balanceOf — the minimum sell() needs to check/raise allowance", () => {
    const names = items.filter((item) => item.type === "function").map((item) => item.name).sort();
    expect(names).toEqual(["allowance", "approve", "balanceOf"].sort());
  });
});
