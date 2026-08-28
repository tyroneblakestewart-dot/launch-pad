import { describe, expect, it, vi } from "vitest";
import {
  formatCompactUsd,
  formatHolderCount,
  formatHolderPercent,
  formatPriceChange,
  formatTimeAgoSeconds,
  formatUsdPrice,
  shortenAddress,
} from "@/lib/token-page-format";

describe("shortenAddress", () => {
  it("shortens a long address to the head…tail form", () => {
    expect(shortenAddress("0x3bf7447cd055f1475a8b09090c7b062abc9d3798")).toBe("0x3bf7…3798");
  });

  it("leaves a short value untouched", () => {
    expect(shortenAddress("short")).toBe("short");
  });
});

describe("formatCompactUsd", () => {
  it("formats a compact USD amount", () => {
    expect(formatCompactUsd(248_600)).toBe("$248.6K");
  });

  it("returns an em dash for null or non-finite input", () => {
    expect(formatCompactUsd(null)).toBe("—");
    expect(formatCompactUsd(Number.NaN)).toBe("—");
  });
});

describe("formatHolderCount", () => {
  it("formats with thousands separators", () => {
    expect(formatHolderCount(1284)).toBe("1,284");
  });

  it("returns an em dash for null", () => {
    expect(formatHolderCount(null)).toBe("—");
  });
});

describe("formatHolderPercent", () => {
  it("formats a normal percentage to 2 decimal places", () => {
    expect(formatHolderPercent(4.821)).toBe("4.82%");
  });

  it("floors tiny percentages to <0.01%", () => {
    expect(formatHolderPercent(0.001)).toBe("<0.01%");
  });

  it("returns an em dash for null", () => {
    expect(formatHolderPercent(null)).toBe("—");
  });
});

describe("formatUsdPrice", () => {
  it("formats prices at or above $1 with 4 decimals", () => {
    expect(formatUsdPrice(1.5)).toBe("$1.5000");
  });

  it("keeps sub-cent precision visible instead of rounding to $0.00", () => {
    const formatted = formatUsdPrice(0.0002486);
    expect(formatted).not.toBe("$0.00");
    expect(formatted).toContain("0.0002486".slice(0, 6));
  });

  it("returns an em dash for null or non-finite input", () => {
    expect(formatUsdPrice(null)).toBe("—");
    expect(formatUsdPrice(Number.NaN)).toBe("—");
  });
});

describe("formatPriceChange", () => {
  it("formats a positive change with an up arrow", () => {
    expect(formatPriceChange(34.7)).toEqual({ label: "▲ 34.7%", up: true });
  });

  it("formats a negative change with a down arrow and no minus sign", () => {
    expect(formatPriceChange(-4.2)).toEqual({ label: "▼ 4.2%", up: false });
  });

  it("returns null for missing data", () => {
    expect(formatPriceChange(null)).toBeNull();
  });
});

describe("formatTimeAgoSeconds", () => {
  it("formats seconds, minutes, hours and days relative to now", () => {
    const nowSeconds = 1_700_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowSeconds * 1000);

    expect(formatTimeAgoSeconds(nowSeconds - 30)).toBe("30s");
    expect(formatTimeAgoSeconds(nowSeconds - 5 * 60)).toBe("5m");
    expect(formatTimeAgoSeconds(nowSeconds - 3 * 3600)).toBe("3h");
    expect(formatTimeAgoSeconds(nowSeconds - 2 * 86_400)).toBe("2d");

    vi.useRealTimers();
  });

  it("returns an empty string for non-finite input", () => {
    expect(formatTimeAgoSeconds(Number.NaN)).toBe("");
  });
});
