import { describe, expect, it } from "vitest";
import { truncateAccountAddress } from "@/lib/account-wallet-state";
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
  countPostsScheduledToday,
  describeWalletMismatch,
  isAwaitingSend,
  isHistoryStatus,
  isPendingSendStatus,
  isUneditedTemplateText,
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

describe("isPendingSendStatus (issue #380)", () => {
  it("only a still-scheduled post anchors the schedule-spread default", () => {
    expect(isPendingSendStatus("scheduled")).toBe(true);
  });

  it("needs_composer is terminal and must not anchor the spread — it never sends automatically", () => {
    expect(isPendingSendStatus("needs_composer")).toBe(false);
  });

  it("sent/failed/partially_sent/canceled are all not pending", () => {
    for (const status of ["sent", "partially_sent", "failed", "canceled"]) {
      expect(isPendingSendStatus(status)).toBe(false);
    }
  });
});

describe("isUneditedTemplateText (issue #380)", () => {
  const TEMPLATE_OUTPUTS = ["🚨 Introducing Test Coin ($TEST) on Solana.\n\nA new community token is preparing for launch.", "The Test Coin community is assembling.\n\nJoin the official $TEST channels."];

  it("flags text that exactly matches one of the current project's template outputs", () => {
    expect(isUneditedTemplateText(TEMPLATE_OUTPUTS[0], TEMPLATE_OUTPUTS)).toBe(true);
  });

  it("ignores surrounding whitespace differences", () => {
    expect(isUneditedTemplateText(`  ${TEMPLATE_OUTPUTS[1]}  `, TEMPLATE_OUTPUTS)).toBe(true);
  });

  it("is false the moment a single character is edited", () => {
    expect(isUneditedTemplateText(`${TEMPLATE_OUTPUTS[0]}!`, TEMPLATE_OUTPUTS)).toBe(false);
  });

  it("is false for empty text and for text matching no template", () => {
    expect(isUneditedTemplateText("", TEMPLATE_OUTPUTS)).toBe(false);
    expect(isUneditedTemplateText("something the user wrote themselves", TEMPLATE_OUTPUTS)).toBe(false);
  });
});

describe("describeWalletMismatch (issue #388)", () => {
  const CONFIRMED = "0x1111111111111111111111111111111111111111";
  const OTHER = "0x2222222222222222222222222222222222222222";

  it("returns null when the wallet app's active account matches the confirmed wallet", () => {
    expect(describeWalletMismatch(CONFIRMED, CONFIRMED)).toBeNull();
  });

  it("is case-insensitive when comparing addresses", () => {
    expect(describeWalletMismatch(CONFIRMED.toUpperCase(), CONFIRMED.toLowerCase())).toBeNull();
  });

  it("returns null when there is no confirmed wallet to compare against yet", () => {
    expect(describeWalletMismatch(OTHER, "")).toBeNull();
  });

  it("returns null when the active account is somehow empty", () => {
    expect(describeWalletMismatch("", CONFIRMED)).toBeNull();
  });

  it("flags a mismatch with a message naming both truncated addresses", () => {
    const message = describeWalletMismatch(OTHER, CONFIRMED);
    expect(message).not.toBeNull();
    expect(message).toContain("Your wallet app is on a different account");
    expect(message).toContain(truncateAccountAddress(OTHER));
    expect(message).toContain(truncateAccountAddress(CONFIRMED));
    expect(message).toContain("Switch accounts in your wallet app, or re-confirm your wallet from the Account panel.");
  });
});

describe("countPostsScheduledToday", () => {
  const now = new Date(2026, 8, 4, 14, 0, 0);

  it("counts only the timestamps landing on the same local calendar day", () => {
    const count = countPostsScheduledToday(
      [
        new Date(2026, 8, 4, 0, 0, 0).toISOString(),
        new Date(2026, 8, 4, 23, 59, 0).toISOString(),
        new Date(2026, 8, 3, 23, 59, 0).toISOString(),
        new Date(2026, 8, 5, 0, 1, 0).toISOString(),
      ],
      now,
    );
    expect(count).toBe(2);
  });

  it("returns zero for an empty list and ignores unparseable timestamps rather than counting them", () => {
    expect(countPostsScheduledToday([], now)).toBe(0);
    expect(countPostsScheduledToday(["", "not a date", "2026-13-45T99:99:99Z"], now)).toBe(0);
  });

  it("never exceeds the list length, so the pill can only ever read n of the cadence ceiling", () => {
    const sameDay = new Date(2026, 8, 4, 9, 0, 0).toISOString();
    expect(countPostsScheduledToday([sameDay, sameDay, sameDay], now)).toBe(3);
    expect(countPostsScheduledToday([sameDay], now)).toBeLessThanOrEqual(cadenceQueueTarget("active"));
  });
});
