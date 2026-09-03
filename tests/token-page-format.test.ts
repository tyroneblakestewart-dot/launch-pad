import { describe, expect, it, vi } from "vitest";
import {
  formatCompactUsd,
  formatFeeNote,
  formatHolderCount,
  formatHolderPercent,
  formatLaunchAge,
  formatNativeAmountSixSigFigsTrimmed,
  formatNativeFixed,
  formatNativePriceAtDecimals,
  formatNativePriceSixSigFigs,
  formatPriceChange,
  formatSharePercent,
  formatSignedPercent,
  formatTimeAgoSeconds,
  formatTokenBalanceAmount,
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

describe("formatSharePercent", () => {
  it("formats a Holder-breakdown share at one decimal place", () => {
    expect(formatSharePercent(18.43)).toBe("18.4%");
    expect(formatSharePercent(4.2)).toBe("4.2%");
    expect(formatSharePercent(100)).toBe("100.0%");
  });

  it("renders a real zero as 0.0% but an unknown as an em dash", () => {
    expect(formatSharePercent(0)).toBe("0.0%");
    expect(formatSharePercent(null)).toBe("—");
    expect(formatSharePercent(Number.NaN)).toBe("—");
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

describe("formatNativePriceSixSigFigs", () => {
  it("formats a sub-cent price to exactly six significant figures", () => {
    expect(formatNativePriceSixSigFigs(0.0000359717123)).toBe("0.0000359717");
  });

  it("formats a price >= 1 to six significant figures too", () => {
    expect(formatNativePriceSixSigFigs(1)).toBe("1.00000");
  });

  it("formats exactly zero", () => {
    expect(formatNativePriceSixSigFigs(0)).toBe("0.000000");
  });

  it("returns an em dash for null, non-finite or negative input", () => {
    expect(formatNativePriceSixSigFigs(null)).toBe("—");
    expect(formatNativePriceSixSigFigs(Number.NaN)).toBe("—");
    expect(formatNativePriceSixSigFigs(-1)).toBe("—");
  });
});

describe("formatNativePriceAtDecimals (issue #464 item 2)", () => {
  it("formats at exactly the given decimal count, not the value's own significant figures", () => {
    expect(formatNativePriceAtDecimals(3.3e-26, 14)).toBe("0.00000000000000");
    expect(formatNativePriceAtDecimals(2.5e-9, 14)).toBe("0.00000000250000");
    expect(formatNativePriceAtDecimals(6e-8, 14)).toBe("0.00000006000000");
  });

  it("rounds instead of truncating", () => {
    expect(formatNativePriceAtDecimals(0.123456, 2)).toBe("0.12");
    expect(formatNativePriceAtDecimals(0.125, 2)).toBe("0.13");
  });

  it("returns an em dash for null, non-finite or negative input", () => {
    expect(formatNativePriceAtDecimals(null, 6)).toBe("—");
    expect(formatNativePriceAtDecimals(Number.NaN, 6)).toBe("—");
    expect(formatNativePriceAtDecimals(-1, 6)).toBe("—");
  });

  it("clamps a negative decimal count to zero instead of throwing", () => {
    expect(formatNativePriceAtDecimals(4.2, -1)).toBe("4");
  });
});

describe("formatNativeFixed", () => {
  it("formats at the given decimal precision", () => {
    expect(formatNativeFixed(3.126, 2)).toBe("3.13");
    expect(formatNativeFixed(184.2, 1)).toBe("184.2");
  });

  it("returns an em dash for null or non-finite input", () => {
    expect(formatNativeFixed(null, 2)).toBe("—");
    expect(formatNativeFixed(Number.NaN, 2)).toBe("—");
  });
});

describe("formatNativeAmountSixSigFigsTrimmed (issue #447 item 4, tiny-amount floor added in issue #464 item 3)", () => {
  it("trims trailing zeros off a whole-number amount", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(4)).toBe("4");
  });

  it("trims trailing zeros off a small amount that still needs full precision", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(0.01)).toBe("0.01");
  });

  it("keeps every significant figure for a very small amount instead of rounding to zero", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(0.0000099)).toBe("0.0000099");
  });

  it("formats zero as a bare 0, not 0.000000", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(0)).toBe("0");
  });

  it("returns an em dash for null or negative input", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(null)).toBe("—");
    expect(formatNativeAmountSixSigFigsTrimmed(-1)).toBe("—");
  });

  // Issue #460 item 10: the Stats panel's VOLUME/BUY VOL/SELL VOL (and every
  // other fixed-decimal ETH amount on the token page) previously rounded a
  // trade around 0.0002 ETH down to "0.0 ETH" — this is the shared helper
  // now used everywhere that rounding happened instead.
  it("keeps small trade-sized amounts readable instead of rounding to 0.0 (issue #460 item 10)", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(0.0002)).toBe("0.0002");
  });

  it("still reads naturally for a large whole-ETH-ish amount", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(184.2)).toBe("184.2");
  });

  // Issue #464 item 3: a curve reserve of a handful of wei previously
  // rendered its full 18-decimal value, e.g.
  // "0.000000000000000001 / 0.01 ETH". Every call site already appends its
  // own " ETH" suffix, so the floor text below reads "<0.000001 ETH" once
  // concatenated, matching the issue's exact wording.
  it("floors 1 wei (below 0.000001 ETH) to the '<0.000001' floor text", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(0.000000000000000001)).toBe("<0.000001");
  });

  it("floors 5e-7 (below 0.000001 ETH) to the '<0.000001' floor text", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(5e-7)).toBe("<0.000001");
  });

  it("formats exactly 0.000001 ETH (the floor boundary itself) normally, not as the floor text", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(1e-6)).toBe("0.000001");
  });

  it("formats exactly zero as a bare '0', not the floor text", () => {
    expect(formatNativeAmountSixSigFigsTrimmed(0)).toBe("0");
  });
});

describe("formatSignedPercent", () => {
  it("formats a positive value with a leading plus sign", () => {
    expect(formatSignedPercent(11.924, 2)).toBe("+11.92%");
  });

  it("formats a negative value with a leading minus sign", () => {
    expect(formatSignedPercent(-4.2, 2)).toBe("-4.20%");
  });

  it("formats exactly zero with a leading plus sign", () => {
    expect(formatSignedPercent(0, 2)).toBe("+0.00%");
  });

  it("returns an em dash for null or non-finite input", () => {
    expect(formatSignedPercent(null, 2)).toBe("—");
    expect(formatSignedPercent(Number.NaN, 2)).toBe("—");
  });
});

describe("formatLaunchAge", () => {
  it("formats minutes, hours and days relative to now", () => {
    const nowMs = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    expect(formatLaunchAge(new Date(nowMs - 30_000).toISOString())).toBe("JUST NOW");
    expect(formatLaunchAge(new Date(nowMs - 5 * 60_000).toISOString())).toBe("5M AGO");
    expect(formatLaunchAge(new Date(nowMs - 3 * 3_600_000).toISOString())).toBe("3H AGO");
    expect(formatLaunchAge(new Date(nowMs - 2 * 86_400_000).toISOString())).toBe("2D AGO");

    vi.useRealTimers();
  });

  it("returns an em dash for null or an invalid timestamp", () => {
    expect(formatLaunchAge(null)).toBe("—");
    expect(formatLaunchAge("not a date")).toBe("—");
  });
});

describe("formatTokenBalanceAmount (issue #458 item 4)", () => {
  it("adds thousands separators and caps at two decimals", () => {
    expect(formatTokenBalanceAmount(74_503.2649)).toBe("74,503.26");
  });

  it("never shows more than two decimals even for a tiny fractional balance", () => {
    expect(formatTokenBalanceAmount(0.123456789)).toBe("0.12");
  });

  it("formats a whole number with no trailing decimal point", () => {
    expect(formatTokenBalanceAmount(1_000_000)).toBe("1,000,000");
  });

  it("returns an em dash for null or non-finite input", () => {
    expect(formatTokenBalanceAmount(null)).toBe("—");
    expect(formatTokenBalanceAmount(Number.NaN)).toBe("—");
  });
});

describe("formatFeeNote", () => {
  it("builds the bonding-phase fee note from the curve's real fee constants", () => {
    expect(formatFeeNote(100n, 6_000n, 4_000n, false)).toBe("1% fee · 60% treasury / 40% creator · bonding");
  });

  it("flips the phase word to graduated", () => {
    expect(formatFeeNote(100n, 6_000n, 4_000n, true)).toBe("1% fee · 60% treasury / 40% creator · graduated");
  });
});
