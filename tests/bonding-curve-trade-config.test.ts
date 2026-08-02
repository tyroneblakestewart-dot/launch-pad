import { describe, expect, it } from "vitest";
import { ERC20_MIN_ABI, HOODLUMS_BONDING_CURVE_TRADE_ABI } from "../lib/bonding-curve-config";

type AbiItemShape = { type: string; name?: string; stateMutability?: string };

describe("HOODLUMS_BONDING_CURVE_TRADE_ABI", () => {
  const items = HOODLUMS_BONDING_CURVE_TRADE_ABI as unknown as readonly AbiItemShape[];

  it("exposes token identity, quoting and trading — kept separate from the read-only graduation-status ABI", () => {
    const names = items.filter((item) => item.type === "function").map((item) => item.name).sort();
    expect(names).toEqual(["buy", "quoteBuy", "quoteSell", "sell", "token"].sort());
  });

  it("marks buy() and sell() as payable/nonpayable, not view — they are wallet-signed transactions", () => {
    const buy = items.find((item) => item.name === "buy");
    const sell = items.find((item) => item.name === "sell");
    expect(buy?.stateMutability).toBe("payable");
    expect(sell?.stateMutability).toBe("nonpayable");
  });

  it("keeps token()/quoteBuy()/quoteSell() as view reads", () => {
    for (const name of ["token", "quoteBuy", "quoteSell"]) {
      expect(items.find((item) => item.name === name)?.stateMutability).toBe("view");
    }
  });
});

describe("ERC20_MIN_ABI", () => {
  const items = ERC20_MIN_ABI as unknown as readonly AbiItemShape[];

  it("exposes exactly allowance, approve and balanceOf — the minimum sell() needs to check/raise allowance", () => {
    const names = items.filter((item) => item.type === "function").map((item) => item.name).sort();
    expect(names).toEqual(["allowance", "approve", "balanceOf"].sort());
  });
});
