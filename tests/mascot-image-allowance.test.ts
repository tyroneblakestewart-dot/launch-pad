import { describe, expect, it } from "vitest";
import {
  buildMascotImageUsage,
  describeMascotImageAllowance,
  describeMascotImageAllowanceDetail,
  isMascotImageAllowanceUsed,
  nextUtcMidnightIso,
  utcDayKey,
} from "@/lib/mascot-image-allowance";
import { createMemoryMascotImageUsageStore } from "@/lib/server/mascot-image-usage-store";
import { MAX_MASCOT_IMAGES_PER_DAY } from "@/lib/social-studio-types";

describe("daily mascot-image allowance maths", () => {
  const late = new Date("2026-09-05T23:59:30.000Z");

  it("is two a day per token, resetting at the next UTC midnight", () => {
    expect(MAX_MASCOT_IMAGES_PER_DAY).toBe(2);
    expect(utcDayKey(late)).toBe("2026-09-05");
    expect(nextUtcMidnightIso(late)).toBe("2026-09-06T00:00:00.000Z");
    expect(buildMascotImageUsage(1, late)).toEqual({ usedToday: 1, limit: 2, resetsAt: "2026-09-06T00:00:00.000Z" });
  });

  it("describes the pill and the detail line, and knows when the allowance is used up", () => {
    expect(describeMascotImageAllowance(null)).toBe("0/2 AI images");
    expect(describeMascotImageAllowance(buildMascotImageUsage(1, late))).toBe("1/2 AI images");
    expect(describeMascotImageAllowance(buildMascotImageUsage(7, late))).toBe("2/2 AI images");
    expect(describeMascotImageAllowanceDetail(null)).toContain("2 mascot images a day per token");
    expect(describeMascotImageAllowanceDetail(buildMascotImageUsage(2, late))).toBe("2/2 used today — resets at midnight UTC");
    expect(isMascotImageAllowanceUsed(null)).toBe(false);
    expect(isMascotImageAllowanceUsed(buildMascotImageUsage(1, late))).toBe(false);
    expect(isMascotImageAllowanceUsed(buildMascotImageUsage(2, late))).toBe(true);
  });
});

describe("mascot image usage store (memory contract)", () => {
  const WALLET = "0xAbC0000000000000000000000000000000000001";

  it("reserves up to the limit per wallet + project + day, then refuses", async () => {
    const store = createMemoryMascotImageUsageStore();
    expect(await store.reserve(WALLET, "proj-1", "2026-09-05", 2)).toEqual({ allowed: true, usedToday: 1 });
    expect(await store.reserve(WALLET.toLowerCase(), "proj-1", "2026-09-05", 2)).toEqual({ allowed: true, usedToday: 2 });
    expect(await store.reserve(WALLET, "proj-1", "2026-09-05", 2)).toEqual({ allowed: false, usedToday: 2 });
    // Another token on the same wallet has its own allowance; another day starts fresh.
    expect(await store.reserve(WALLET, "proj-2", "2026-09-05", 2)).toEqual({ allowed: true, usedToday: 1 });
    expect(await store.reserve(WALLET, "proj-1", "2026-09-06", 2)).toEqual({ allowed: true, usedToday: 1 });
  });

  it("release gives one back and never goes below zero", async () => {
    const store = createMemoryMascotImageUsageStore();
    await store.reserve(WALLET, "proj-1", "2026-09-05", 2);
    await store.release(WALLET, "proj-1", "2026-09-05");
    await store.release(WALLET, "proj-1", "2026-09-05");
    expect(await store.usage(WALLET, "proj-1", "2026-09-05")).toBe(0);
  });
});
