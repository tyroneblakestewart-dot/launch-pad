// Server-only pricing/configuration module for the Operations cost/margin
// cockpit (issue #368). Reads non-negative finite prices from env with
// documented defaults, and computes estimated costs from provider-returned
// usage only — never from prompt-length estimates.

export type AiPricingRates = {
  inputCostUsdPerMillion: number;
  cachedInputCostUsdPerMillion: number;
  outputCostUsdPerMillion: number;
  webSearchCostUsdPerCall: number;
  imageCostUsdPerImage: number;
};

// Current official defaults for gpt-5-mini / gpt-image-1 (medium, 1024x1024)
// as of issue #368 — verify against https://platform.openai.com/docs/pricing
// and https://developers.openai.com/api/docs/models/gpt-5-mini /
// https://developers.openai.com/api/docs/models/gpt-image-1 before relying on
// these for a live cost decision; prices change over time. Image *quality* is
// a fixed owner decision hardcoded in lib/server/mascot-image-request.ts, not
// a configurable setting — only the per-image *price* below is configurable.
export const DEFAULT_AI_PRICING_RATES: AiPricingRates = {
  inputCostUsdPerMillion: 0.25,
  cachedInputCostUsdPerMillion: 0.025,
  outputCostUsdPerMillion: 2.0,
  webSearchCostUsdPerCall: 0.01,
  imageCostUsdPerImage: 0.042,
};

const AI_PRICING_ENV_VARS: Array<{ key: keyof AiPricingRates; envVar: string }> = [
  { key: "inputCostUsdPerMillion", envVar: "OPENAI_INPUT_COST_USD_PER_MILLION" },
  { key: "cachedInputCostUsdPerMillion", envVar: "OPENAI_CACHED_INPUT_COST_USD_PER_MILLION" },
  { key: "outputCostUsdPerMillion", envVar: "OPENAI_OUTPUT_COST_USD_PER_MILLION" },
  { key: "webSearchCostUsdPerCall", envVar: "OPENAI_WEB_SEARCH_COST_USD_PER_CALL" },
  { key: "imageCostUsdPerImage", envVar: "OPENAI_IMAGE_COST_USD_PER_IMAGE" },
];

/**
 * Strictly parses a configured price: the whole trimmed string must be a
 * finite non-negative number, so a partially-parsed value like "0.25junk"
 * (which Number.parseFloat would silently accept as 0.25) is rejected rather
 * than quietly used. An absent or blank variable is "unset", not invalid.
 */
function parseNonNegativePrice(raw: string | undefined): { value: number | null; presentAndInvalid: boolean } {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { value: null, presentAndInvalid: false };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return { value: null, presentAndInvalid: true };
  return { value: parsed, presentAndInvalid: false };
}

function readNonNegativeFloat(raw: string | undefined, fallback: number): number {
  const { value } = parseNonNegativePrice(raw);
  return value ?? fallback;
}

export function readAiPricingRates(env: Record<string, string | undefined> = process.env): AiPricingRates {
  return {
    inputCostUsdPerMillion: readNonNegativeFloat(
      env.OPENAI_INPUT_COST_USD_PER_MILLION,
      DEFAULT_AI_PRICING_RATES.inputCostUsdPerMillion,
    ),
    cachedInputCostUsdPerMillion: readNonNegativeFloat(
      env.OPENAI_CACHED_INPUT_COST_USD_PER_MILLION,
      DEFAULT_AI_PRICING_RATES.cachedInputCostUsdPerMillion,
    ),
    outputCostUsdPerMillion: readNonNegativeFloat(
      env.OPENAI_OUTPUT_COST_USD_PER_MILLION,
      DEFAULT_AI_PRICING_RATES.outputCostUsdPerMillion,
    ),
    webSearchCostUsdPerCall: readNonNegativeFloat(
      env.OPENAI_WEB_SEARCH_COST_USD_PER_CALL,
      DEFAULT_AI_PRICING_RATES.webSearchCostUsdPerCall,
    ),
    imageCostUsdPerImage: readNonNegativeFloat(
      env.OPENAI_IMAGE_COST_USD_PER_IMAGE,
      DEFAULT_AI_PRICING_RATES.imageCostUsdPerImage,
    ),
  };
}

export type AiPricingConfigIssue = {
  variable: string;
  rawValue: string;
  message: string;
};

/**
 * Reports every configured (present, non-blank) pricing env var that failed
 * strict parsing — negative, non-finite, or partially-parsed like
 * "0.25junk". Recording still safely falls back to the documented default
 * for these (readAiPricingRates/readNonNegativeFloat above), but that
 * fallback must stay visible in System Health rather than silently looking
 * healthy (issue #368 correction pass).
 */
export function validateAiPricingConfig(env: Record<string, string | undefined> = process.env): AiPricingConfigIssue[] {
  const issues: AiPricingConfigIssue[] = [];
  for (const { envVar } of AI_PRICING_ENV_VARS) {
    const raw = env[envVar];
    if (raw === undefined) continue;
    const { presentAndInvalid } = parseNonNegativePrice(raw);
    if (presentAndInvalid) {
      issues.push({
        variable: envVar,
        rawValue: raw,
        message: `${envVar}="${raw}" is not a valid non-negative number; the documented default is being used instead.`,
      });
    }
  }
  return issues;
}

export type TextUsageForCost = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  webSearchCallCount: number;
};

/** Uncached input tokens billed at the standard input rate; the rest is billed at the cached rate. */
export function calculateUncachedInputTokens(inputTokens: number, cachedInputTokens: number): number {
  return Math.max(0, inputTokens - Math.max(0, cachedInputTokens));
}

export function calculateTextCostUsd(usage: TextUsageForCost, rates: AiPricingRates): number {
  const uncachedInputTokens = calculateUncachedInputTokens(usage.inputTokens, usage.cachedInputTokens);
  const inputCost = (uncachedInputTokens / 1_000_000) * rates.inputCostUsdPerMillion;
  const cachedCost = (Math.max(0, usage.cachedInputTokens) / 1_000_000) * rates.cachedInputCostUsdPerMillion;
  const outputCost = (Math.max(0, usage.outputTokens) / 1_000_000) * rates.outputCostUsdPerMillion;
  const searchCost = Math.max(0, usage.webSearchCallCount) * rates.webSearchCostUsdPerCall;
  return inputCost + cachedCost + outputCost + searchCost;
}

export function calculateImageCostUsd(imageCount: number, rates: AiPricingRates): number {
  return Math.max(0, imageCount) * rates.imageCostUsdPerImage;
}

export type OperationsCostThresholds = {
  amberUsd: number;
  redUsd: number;
  /** false when red <= amber — an invalid configuration that must fail safely and stay visible in System Health rather than silently misbehave. */
  valid: boolean;
  message: string;
};

export const DEFAULT_OPERATIONS_MONTHLY_COST_AMBER_USD = 100;
export const DEFAULT_OPERATIONS_MONTHLY_COST_RED_USD = 250;

export function readOperationsCostThresholds(env: Record<string, string | undefined> = process.env): OperationsCostThresholds {
  const amberUsd = readNonNegativeFloat(env.OPERATIONS_MONTHLY_COST_AMBER_USD, DEFAULT_OPERATIONS_MONTHLY_COST_AMBER_USD);
  const redUsd = readNonNegativeFloat(env.OPERATIONS_MONTHLY_COST_RED_USD, DEFAULT_OPERATIONS_MONTHLY_COST_RED_USD);
  const valid = redUsd > amberUsd;
  return {
    amberUsd,
    redUsd,
    valid,
    message: valid
      ? ""
      : `Invalid threshold configuration: OPERATIONS_MONTHLY_COST_RED_USD ($${redUsd}) must be greater than OPERATIONS_MONTHLY_COST_AMBER_USD ($${amberUsd}).`,
  };
}
