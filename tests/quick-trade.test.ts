import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { grossNativeInForExactNet } from "@/lib/bonding-curve-fee-math";
import {
  DEFAULT_QUICK_TRADE_SETTINGS,
  QUICK_TRADE_STORAGE_KEY,
  buildQuickTradeConsentMessage,
  clearQuickTradeRecord,
  normaliseQuickTradeSettings,
  planQuickBuy,
  quickSellAmountRaw,
  readQuickTradeRecord,
  writeQuickTradeRecord,
  type StorageLike,
} from "@/lib/quick-trade";

const WALLET = "0x3990b0b29f08c1D415978E8EDB93aD00E5dC966a" as const;

function memoryStorage(): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

const RECORD = {
  ...DEFAULT_QUICK_TRADE_SETTINGS,
  message: "consent",
  signature: "0xabc123" as const,
  signedAt: "2026-09-03T17:00:00.000Z",
};

describe("Quick Trade consent message", () => {
  it("binds the consent to the host and the wallet, and states the two non-custodial facts in plain English", () => {
    const message = buildQuickTradeConsentMessage(WALLET, "hoodlums.dev", "2026-09-03T17:00:00.000Z");
    expect(message).toContain("Enable Quick Trade on hoodlums.dev");
    expect(message).toContain(`Wallet: ${WALLET}`);
    expect(message).toContain("Every trade still requires your wallet's confirmation.");
    expect(message).toContain("never\nholds your keys or funds");
    expect(message).toContain("Signed: 2026-09-03T17:00:00.000Z");
    // A signature for one host can never enable Quick Trade on another.
    expect(buildQuickTradeConsentMessage(WALLET, "evil.example", "2026-09-03T17:00:00.000Z")).not.toBe(message);
  });
});

describe("Quick Trade settings normalisation", () => {
  it("keeps valid presets and defaults anything off the allowed lists", () => {
    expect(normaliseQuickTradeSettings({ buyPresetEth: "0.5", sellPresetPercent: 75, slippageBps: 300 })).toEqual({
      buyPresetEth: "0.5",
      sellPresetPercent: 75,
      slippageBps: 300,
    });
    expect(normaliseQuickTradeSettings({ buyPresetEth: "5", sellPresetPercent: 33, slippageBps: 9999 })).toEqual(DEFAULT_QUICK_TRADE_SETTINGS);
    expect(normaliseQuickTradeSettings(undefined)).toEqual(DEFAULT_QUICK_TRADE_SETTINGS);
    expect(normaliseQuickTradeSettings("garbage")).toEqual(DEFAULT_QUICK_TRADE_SETTINGS);
  });
});

describe("Quick Trade per-wallet storage", () => {
  it("round-trips a record under one static key, keyed by the lowercased wallet", () => {
    const storage = memoryStorage();
    writeQuickTradeRecord(storage, WALLET, RECORD);
    expect(Object.keys(storage.dump())).toEqual([QUICK_TRADE_STORAGE_KEY]);
    expect(Object.keys(JSON.parse(storage.dump()[QUICK_TRADE_STORAGE_KEY]))).toEqual([WALLET.toLowerCase()]);
    expect(readQuickTradeRecord(storage, WALLET)).toEqual(RECORD);
    expect(readQuickTradeRecord(storage, WALLET.toLowerCase() as typeof WALLET)).toEqual(RECORD);
  });

  it("returns null for an unknown wallet, and never lets one wallet's consent enable another", () => {
    const storage = memoryStorage();
    writeQuickTradeRecord(storage, WALLET, RECORD);
    expect(readQuickTradeRecord(storage, "0x1111111111111111111111111111111111111111")).toBeNull();
  });

  it("rejects a record missing or malforming its consent fields, and normalises its settings", () => {
    const storage = memoryStorage();
    storage.setItem(
      QUICK_TRADE_STORAGE_KEY,
      JSON.stringify({
        [WALLET.toLowerCase()]: { buyPresetEth: "77", sellPresetPercent: 50, slippageBps: 50, message: "m", signature: "0xdeadbeef", signedAt: "t" },
        "0x2222222222222222222222222222222222222222": { message: "m", signature: "not-hex", signedAt: "t" },
        "0x3333333333333333333333333333333333333333": { message: "", signature: "0xaa", signedAt: "t" },
      }),
    );
    expect(readQuickTradeRecord(storage, WALLET)).toEqual({
      buyPresetEth: "0.1",
      sellPresetPercent: 50,
      slippageBps: 50,
      message: "m",
      signature: "0xdeadbeef",
      signedAt: "t",
    });
    expect(readQuickTradeRecord(storage, "0x2222222222222222222222222222222222222222")).toBeNull();
    expect(readQuickTradeRecord(storage, "0x3333333333333333333333333333333333333333")).toBeNull();
  });

  it("survives corrupt storage contents and a throwing storage without throwing itself", () => {
    const storage = memoryStorage();
    storage.setItem(QUICK_TRADE_STORAGE_KEY, "{not json");
    expect(readQuickTradeRecord(storage, WALLET)).toBeNull();
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => writeQuickTradeRecord(throwing, WALLET, RECORD)).not.toThrow();
    expect(readQuickTradeRecord(throwing, WALLET)).toBeNull();
  });

  it("clears only the given wallet's record", () => {
    const storage = memoryStorage();
    const other = "0x1111111111111111111111111111111111111111";
    writeQuickTradeRecord(storage, WALLET, RECORD);
    writeQuickTradeRecord(storage, other, RECORD);
    clearQuickTradeRecord(storage, WALLET);
    expect(readQuickTradeRecord(storage, WALLET)).toBeNull();
    expect(readQuickTradeRecord(storage, other)).toEqual(RECORD);
  });
});

describe("quickSellAmountRaw", () => {
  it("takes an exact integer share of the balance and sends the whole balance at 100%", () => {
    expect(quickSellAmountRaw(1000n, 25)).toBe(250n);
    expect(quickSellAmountRaw(1000n, 75)).toBe(750n);
    expect(quickSellAmountRaw(999n, 50)).toBe(499n);
    expect(quickSellAmountRaw(1000n, 100)).toBe(1000n);
    expect(quickSellAmountRaw(0n, 50)).toBe(0n);
  });
});

describe("planQuickBuy", () => {
  const preset = parseEther("0.1");

  it("sends the preset unchanged when the wallet can afford it and graduation is far away", () => {
    expect(planQuickBuy(preset, parseEther("1"), parseEther("5"))).toEqual({ ok: true, grossWei: preset, clampedToGraduation: false });
  });

  it("clamps to the exact gross that nets to what is left to graduate, using the same maths as the form's MAX preset", () => {
    const remaining = parseEther("0.01");
    const plan = planQuickBuy(preset, parseEther("1"), remaining);
    expect(plan).toEqual({ ok: true, grossWei: grossNativeInForExactNet(remaining), clampedToGraduation: true });
    if (plan.ok) expect(plan.grossWei).toBeLessThan(preset);
  });

  it("refuses when the wallet cannot afford the (possibly clamped) amount, and when nothing is left to graduate", () => {
    expect(planQuickBuy(preset, parseEther("0.05"), parseEther("5"))).toEqual({ ok: false, reason: "insufficient-balance" });
    expect(planQuickBuy(preset, parseEther("1"), 0n)).toEqual({ ok: false, reason: "nothing-left-to-graduate" });
  });

  it("never treats an unread (null) balance or remainder as zero", () => {
    expect(planQuickBuy(preset, null, null)).toEqual({ ok: true, grossWei: preset, clampedToGraduation: false });
  });
});
