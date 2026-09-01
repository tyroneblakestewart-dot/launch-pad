import { describe, expect, it } from "vitest";
import { computePoolSpotPriceNativePerTokenRaw } from "@/lib/uniswap-v3-spot-price";

const Q96 = 2n ** 96n;

describe("computePoolSpotPriceNativePerTokenRaw", () => {
  it("resolves sqrtPriceX96 = 2^96 (price ratio 1:1) to 1 ETH per whole token when native is token1", () => {
    expect(computePoolSpotPriceNativePerTokenRaw(Q96, false)).toBe(10n ** 18n);
  });

  it("resolves sqrtPriceX96 = 2^96 (price ratio 1:1) to 1 ETH per whole token when native is token0", () => {
    expect(computePoolSpotPriceNativePerTokenRaw(Q96, true)).toBe(10n ** 18n);
  });

  it("resolves sqrtPriceX96 = 2 * 2^96 (price ratio 4:1, token1 per token0) directly when native is token1", () => {
    // sqrt(price) = 2 => price = 4 => 4 ETH per whole token when token1 is native.
    expect(computePoolSpotPriceNativePerTokenRaw(2n * Q96, false)).toBe(4n * 10n ** 18n);
  });

  it("inverts the ratio when native is token0 instead", () => {
    // Same sqrtPriceX96 as above (raw ratio 4), but now token1 is the project
    // token, so ETH-per-whole-token is the reciprocal: 1/4 = 0.25 ETH.
    expect(computePoolSpotPriceNativePerTokenRaw(2n * Q96, true)).toBe(250_000_000_000_000_000n);
  });

  it("returns 0 for a zero sqrtPriceX96 regardless of token ordering", () => {
    expect(computePoolSpotPriceNativePerTokenRaw(0n, false)).toBe(0n);
    expect(computePoolSpotPriceNativePerTokenRaw(0n, true)).toBe(0n);
  });
});
