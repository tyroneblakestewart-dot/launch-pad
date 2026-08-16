import { describe, expect, it } from "vitest";
import { MAX_POSTS_PER_DAY, MAX_QUEUE_TARGET, POSTING_CADENCE_OPTIONS } from "@/lib/social-studio-types";
import {
  MAX_ROLLING_RECENT_DRAFTS,
  advanceRollingRecentDrafts,
  buildXIntentUrl,
  cadenceQueueTarget,
  cadenceSpreadHoursMs,
  clampQueueTarget,
  computeDefaultScheduledAt,
  connectedPlatforms,
  isAwaitingSend,
  isHistoryStatus,
  normalisePostingCadence,
  replenishShortfall,
} from "@/lib/social-studio-queue";

describe("connectedPlatforms", () => {
  it("keeps only platforms with status connected", () => {
    expect(
      connectedPlatforms([
        { platform: "x", status: "connected" },
        { platform: "telegram", status: "reconnect_needed" },
      ]),
    ).toEqual(["x"]);
  });

  it("returns an empty list when nothing is connected", () => {
    expect(connectedPlatforms([])).toEqual([]);
  });
});

describe("replenishShortfall", () => {
  it("is the gap between the target and how many drafts are ready", () => {
    expect(replenishShortfall(2, 5)).toBe(3);
  });

  it("never goes negative when the pool is already at or above target", () => {
    expect(replenishShortfall(5, 5)).toBe(0);
    expect(replenishShortfall(9, 5)).toBe(0);
  });
});

describe("clampQueueTarget", () => {
  it("rounds and clamps into [1, MAX_QUEUE_TARGET]", () => {
    expect(clampQueueTarget(7.6)).toBe(8);
    expect(clampQueueTarget(0)).toBe(1);
    expect(clampQueueTarget(-3)).toBe(1);
    expect(clampQueueTarget(MAX_QUEUE_TARGET + 50)).toBe(MAX_QUEUE_TARGET);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampQueueTarget(Number.NaN)).toBe(5);
    expect(clampQueueTarget(Number.POSITIVE_INFINITY)).toBe(5);
  });
});

describe("isAwaitingSend / isHistoryStatus", () => {
  it("classifies scheduled and needs_composer as awaiting send", () => {
    expect(isAwaitingSend("scheduled")).toBe(true);
    expect(isAwaitingSend("needs_composer")).toBe(true);
    expect(isAwaitingSend("sent")).toBe(false);
  });

  it("classifies terminal outcomes as history", () => {
    expect(isHistoryStatus("sent")).toBe(true);
    expect(isHistoryStatus("partially_sent")).toBe(true);
    expect(isHistoryStatus("failed")).toBe(true);
    expect(isHistoryStatus("canceled")).toBe(true);
    expect(isHistoryStatus("scheduled")).toBe(false);
    expect(isHistoryStatus("needs_composer")).toBe(false);
  });
});

describe("computeDefaultScheduledAt", () => {
  it("defaults to now when nothing else is scheduled", () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    expect(computeDefaultScheduledAt([], now).toISOString()).toBe(now.toISOString());
  });

  it("defaults to now when the latest scheduled post is already in the past", () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    expect(computeDefaultScheduledAt(["2026-08-16T10:00:00.000Z"], now).toISOString()).toBe(now.toISOString());
  });

  it("spreads out by the interval past the latest future scheduled post", () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    const result = computeDefaultScheduledAt(["2026-08-16T13:00:00.000Z"], now, 2 * 60 * 60 * 1000);
    expect(result.toISOString()).toBe("2026-08-16T15:00:00.000Z");
  });

  it("ignores unparseable timestamps", () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    expect(computeDefaultScheduledAt(["not-a-date"], now).toISOString()).toBe(now.toISOString());
  });
});

describe("buildXIntentUrl", () => {
  it("URL-encodes the post text into the X intent composer link", () => {
    expect(buildXIntentUrl("hello world & friends")).toBe(
      "https://x.com/intent/post?text=hello%20world%20%26%20friends",
    );
  });
});

describe("advanceRollingRecentDrafts (issue #366)", () => {
  it("prepends the newest draft ahead of the seeded context", () => {
    expect(advanceRollingRecentDrafts(["older draft"], "newest draft")).toEqual(["newest draft", "older draft"]);
  });

  it("caps the rolling window at MAX_ROLLING_RECENT_DRAFTS, dropping the oldest entries", () => {
    const seeded = Array.from({ length: MAX_ROLLING_RECENT_DRAFTS }, (_, index) => `draft ${index}`);
    const next = advanceRollingRecentDrafts(seeded, "brand new draft");
    expect(next.length).toBe(MAX_ROLLING_RECENT_DRAFTS);
    expect(next[0]).toBe("brand new draft");
    expect(next).not.toContain(`draft ${MAX_ROLLING_RECENT_DRAFTS - 1}`);
  });

  it("advancing repeatedly lets each new call see everything generated so far in the batch, not a stale snapshot", () => {
    let rolling: string[] = [];
    rolling = advanceRollingRecentDrafts(rolling, "draft 1");
    rolling = advanceRollingRecentDrafts(rolling, "draft 2");
    rolling = advanceRollingRecentDrafts(rolling, "draft 3");
    expect(rolling).toEqual(["draft 3", "draft 2", "draft 1"]);
  });
});

describe("posting cadence (issue #358)", () => {
  it("never offers a cadence option above the plan's daily posting entitlement", () => {
    expect(POSTING_CADENCE_OPTIONS.length).toBeGreaterThan(0);
    for (const option of POSTING_CADENCE_OPTIONS) {
      expect(option.postsPerDayMax).toBeLessThanOrEqual(MAX_POSTS_PER_DAY);
    }
  });

  it("maps Conservative to its low-end target and Active to the 5/day ceiling", () => {
    expect(cadenceQueueTarget("conservative")).toBe(2);
    expect(cadenceQueueTarget("active")).toBe(5);
    expect(cadenceQueueTarget("active")).toBe(MAX_POSTS_PER_DAY);
  });

  it("spreads a lower-frequency cadence's default schedule times further apart than a higher-frequency one", () => {
    const conservativeSpread = cadenceSpreadHoursMs("conservative");
    const activeSpread = cadenceSpreadHoursMs("active");
    expect(conservativeSpread).toBeGreaterThan(activeSpread);
    expect(conservativeSpread).toBe(8 * 60 * 60 * 1000);
  });

  it("normalisePostingCadence falls back to the default for anything unrecognised", () => {
    expect(normalisePostingCadence("conservative")).toBe("conservative");
    expect(normalisePostingCadence("active")).toBe("active");
    expect(normalisePostingCadence("aggressive")).toBe("active");
    expect(normalisePostingCadence(undefined)).toBe("active");
    expect(normalisePostingCadence(null)).toBe("active");
  });
});
