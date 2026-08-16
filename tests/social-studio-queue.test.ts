import { describe, expect, it } from "vitest";
import { MAX_QUEUE_TARGET } from "@/lib/social-studio-types";
import {
  buildXIntentUrl,
  clampQueueTarget,
  computeDefaultScheduledAt,
  connectedPlatforms,
  isAwaitingSend,
  isHistoryStatus,
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
