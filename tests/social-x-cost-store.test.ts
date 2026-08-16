import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_X_API_SEND_COST_USD,
  DEFAULT_X_MONTHLY_COST_CAP_USD,
  getSocialXCostStore,
  monthBoundsUtc,
  readXApiSendCostUsd,
  readXMonthlyCostCapUsd,
  resetSocialXCostStoreForTests,
} from "@/lib/server/social-x-cost-store";
import { createMemorySocialXCostStore } from "./social-x-cost-test-helpers";

afterEach(() => {
  resetSocialXCostStoreForTests();
  delete process.env.DATABASE_URL;
});

describe("readXApiSendCostUsd / readXMonthlyCostCapUsd", () => {
  it("falls back to the documented defaults when unset", () => {
    expect(readXApiSendCostUsd({})).toBe(DEFAULT_X_API_SEND_COST_USD);
    expect(readXMonthlyCostCapUsd({})).toBe(DEFAULT_X_MONTHLY_COST_CAP_USD);
  });

  it("lets the owner override both via env", () => {
    expect(readXApiSendCostUsd({ SOCIAL_X_API_SEND_COST_USD: "0.02" })).toBe(0.02);
    expect(readXMonthlyCostCapUsd({ SOCIAL_X_MONTHLY_COST_CAP_USD: "10" })).toBe(10);
  });

  it("ignores garbage/negative overrides and falls back to the default", () => {
    expect(readXApiSendCostUsd({ SOCIAL_X_API_SEND_COST_USD: "not-a-number" })).toBe(DEFAULT_X_API_SEND_COST_USD);
    expect(readXApiSendCostUsd({ SOCIAL_X_API_SEND_COST_USD: "-1" })).toBe(DEFAULT_X_API_SEND_COST_USD);
  });
});

describe("monthBoundsUtc", () => {
  it("returns the first-of-month to first-of-next-month UTC window", () => {
    const { start, end } = monthBoundsUtc(new Date("2026-02-15T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("rolls over correctly across a year boundary", () => {
    const { start, end } = monthBoundsUtc(new Date("2026-12-25T00:00:00Z"));
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("unconfigured cost store (no DATABASE_URL)", () => {
  it("never blocks and never throws", async () => {
    delete process.env.DATABASE_URL;
    const store = getSocialXCostStore();
    await expect(store.recordSend("0xabc", "dest-1", 0.015, new Date())).resolves.toBeUndefined();
    await expect(store.monthlyTotalUsd("0xabc", new Date())).resolves.toBe(0);
    await expect(store.monthlyTotalsAllWallets(new Date())).resolves.toEqual([]);
  });
});

describe("in-memory cost store contract", () => {
  it("aggregates sends within the same UTC month for a wallet, excluding other months", async () => {
    const store = createMemorySocialXCostStore();
    await store.recordSend("0xabc", "d1", 0.015, new Date("2026-02-01T00:00:00Z"));
    await store.recordSend("0xabc", "d2", 0.015, new Date("2026-02-28T23:00:00Z"));
    await store.recordSend("0xabc", "d3", 0.015, new Date("2026-03-01T00:00:00Z"));

    expect(await store.monthlyTotalUsd("0xabc", new Date("2026-02-15T00:00:00Z"))).toBeCloseTo(0.03, 5);
  });

  it("keeps totals per wallet independent", async () => {
    const store = createMemorySocialXCostStore();
    await store.recordSend("0xabc", "d1", 0.015, new Date("2026-02-01T00:00:00Z"));
    await store.recordSend("0xdef", "d2", 0.015, new Date("2026-02-01T00:00:00Z"));
    await store.recordSend("0xdef", "d3", 0.015, new Date("2026-02-02T00:00:00Z"));

    const totals = await store.monthlyTotalsAllWallets(new Date("2026-02-15T00:00:00Z"));
    expect(totals).toEqual([
      { walletAddress: "0xdef", totalUsd: expect.closeTo(0.03, 5), sendCount: 2 },
      { walletAddress: "0xabc", totalUsd: expect.closeTo(0.015, 5), sendCount: 1 },
    ]);
  });
});
