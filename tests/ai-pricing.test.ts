import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_PRICING_RATES,
  calculateImageCostUsd,
  calculateTextCostUsd,
  calculateUncachedInputTokens,
  readAiPricingRates,
  readOperationsCostThresholds,
} from "@/lib/server/ai-pricing";

describe("readAiPricingRates", () => {
  it("returns documented defaults when env is empty", () => {
    expect(readAiPricingRates({})).toEqual(DEFAULT_AI_PRICING_RATES);
  });

  it("reads every configured price from env", () => {
    const rates = readAiPricingRates({
      OPENAI_INPUT_COST_USD_PER_MILLION: "1",
      OPENAI_CACHED_INPUT_COST_USD_PER_MILLION: "0.1",
      OPENAI_OUTPUT_COST_USD_PER_MILLION: "4",
      OPENAI_WEB_SEARCH_COST_USD_PER_CALL: "0.02",
      OPENAI_IMAGE_QUALITY: "high",
      OPENAI_IMAGE_COST_USD_PER_IMAGE: "0.08",
    });
    expect(rates).toEqual({
      inputCostUsdPerMillion: 1,
      cachedInputCostUsdPerMillion: 0.1,
      outputCostUsdPerMillion: 4,
      webSearchCostUsdPerCall: 0.02,
      imageQuality: "high",
      imageCostUsdPerImage: 0.08,
    });
  });

  it("falls back to the default for negative, non-finite or unparsable values", () => {
    const rates = readAiPricingRates({
      OPENAI_INPUT_COST_USD_PER_MILLION: "-1",
      OPENAI_OUTPUT_COST_USD_PER_MILLION: "not-a-number",
      OPENAI_WEB_SEARCH_COST_USD_PER_CALL: "Infinity",
    });
    expect(rates.inputCostUsdPerMillion).toBe(DEFAULT_AI_PRICING_RATES.inputCostUsdPerMillion);
    expect(rates.outputCostUsdPerMillion).toBe(DEFAULT_AI_PRICING_RATES.outputCostUsdPerMillion);
    expect(rates.webSearchCostUsdPerCall).toBe(DEFAULT_AI_PRICING_RATES.webSearchCostUsdPerCall);
  });

  it("accepts a configured price of exactly zero, rather than treating it as unset", () => {
    expect(readAiPricingRates({ OPENAI_WEB_SEARCH_COST_USD_PER_CALL: "0" }).webSearchCostUsdPerCall).toBe(0);
  });
});

describe("calculateUncachedInputTokens", () => {
  it("subtracts cached tokens from input tokens", () => {
    expect(calculateUncachedInputTokens(1000, 400)).toBe(600);
  });

  it("never returns a negative value", () => {
    expect(calculateUncachedInputTokens(100, 500)).toBe(0);
  });
});

describe("calculateTextCostUsd", () => {
  const rates = DEFAULT_AI_PRICING_RATES;

  it("computes cost from uncached input + cached input + output + web search", () => {
    const usage = { inputTokens: 2_000_000, cachedInputTokens: 500_000, outputTokens: 1_000_000, webSearchCallCount: 3 };
    const expected =
      ((2_000_000 - 500_000) / 1_000_000) * rates.inputCostUsdPerMillion +
      (500_000 / 1_000_000) * rates.cachedInputCostUsdPerMillion +
      (1_000_000 / 1_000_000) * rates.outputCostUsdPerMillion +
      3 * rates.webSearchCostUsdPerCall;
    expect(calculateTextCostUsd(usage, rates)).toBeCloseTo(expected, 10);
  });

  it("never rounds a tiny call down to exactly zero", () => {
    const usage = { inputTokens: 50, cachedInputTokens: 0, outputTokens: 20, webSearchCallCount: 0 };
    expect(calculateTextCostUsd(usage, rates)).toBeGreaterThan(0);
  });

  it("is zero for zero usage and zero search calls", () => {
    expect(calculateTextCostUsd({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, webSearchCallCount: 0 }, rates)).toBe(0);
  });
});

describe("calculateImageCostUsd", () => {
  it("multiplies successful image count by the per-image rate", () => {
    expect(calculateImageCostUsd(3, DEFAULT_AI_PRICING_RATES)).toBeCloseTo(3 * DEFAULT_AI_PRICING_RATES.imageCostUsdPerImage, 10);
  });

  it("is zero for zero images", () => {
    expect(calculateImageCostUsd(0, DEFAULT_AI_PRICING_RATES)).toBe(0);
  });
});

describe("readOperationsCostThresholds", () => {
  it("returns documented defaults when env is empty", () => {
    const thresholds = readOperationsCostThresholds({});
    expect(thresholds).toMatchObject({ amberUsd: 100, redUsd: 250, valid: true });
  });

  it("is valid when red is strictly greater than amber", () => {
    const thresholds = readOperationsCostThresholds({ OPERATIONS_MONTHLY_COST_AMBER_USD: "50", OPERATIONS_MONTHLY_COST_RED_USD: "51" });
    expect(thresholds.valid).toBe(true);
  });

  it("fails safely (invalid, with a clear message) when red equals amber", () => {
    const thresholds = readOperationsCostThresholds({ OPERATIONS_MONTHLY_COST_AMBER_USD: "100", OPERATIONS_MONTHLY_COST_RED_USD: "100" });
    expect(thresholds.valid).toBe(false);
    expect(thresholds.message).toContain("must be greater than");
  });

  it("fails safely when red is below amber", () => {
    const thresholds = readOperationsCostThresholds({ OPERATIONS_MONTHLY_COST_AMBER_USD: "250", OPERATIONS_MONTHLY_COST_RED_USD: "100" });
    expect(thresholds.valid).toBe(false);
  });
});
