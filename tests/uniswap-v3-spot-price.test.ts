import { describe, expect, it } from "vitest";
import { computeSpotPriceNativePerTokenRaw } from "@/lib/uniswap-v3-spot-price";

// Known sqrtPriceX96 values: 2^96 itself is exactly "price = 1" (token1 per
// token0), and doubling/halving the sqrt scales the underlying price by 4x/0.25x
// (since price = sqrt^2), so these are hand-checkable without a second
// implementation to compare against.
const Q96 = 2n ** 96n;

describe("computeSpotPriceNativePerTokenRaw", () => {
  it("price = 1 (sqrtPriceX96 = 2^96): 1 native per token regardless of ordering", () => {
    expect(computeSpotPriceNativePerTokenRaw(Q96, true)).toBe("1000000000000000000");
    expect(computeSpotPriceNativePerTokenRaw(Q96, false)).toBe("1000000000000000000");
  });

  it("token is token0: raw token1-per-token0 price is the answer directly", () => {
    // sqrtPriceX96 = 2 * 2^96 -> price = 2^2 = 4 token1 per token0.
    expect(computeSpotPriceNativePerTokenRaw(Q96 * 2n, true)).toBe("4000000000000000000");
  });

  it("token is token1 (WETH is token0): the answer is the reciprocal", () => {
    // Same sqrtPriceX96 (token1-per-token0 price = 4), but now token1 is the
    // platform token, so native-per-token = 1/4 = 0.25.
    expect(computeSpotPriceNativePerTokenRaw(Q96 * 2n, false)).toBe("250000000000000000");
  });

  it("a smaller price (sqrtPriceX96 = 2^96 / 2) also inverts correctly across orderings", () => {
    expect(computeSpotPriceNativePerTokenRaw(Q96 / 2n, true)).toBe("250000000000000000");
    expect(computeSpotPriceNativePerTokenRaw(Q96 / 2n, false)).toBe("4000000000000000000");
  });

  it("zero sqrtPriceX96 prices as zero regardless of ordering", () => {
    expect(computeSpotPriceNativePerTokenRaw(0n, true)).toBe("0");
    expect(computeSpotPriceNativePerTokenRaw(0n, false)).toBe("0");
  });
});
