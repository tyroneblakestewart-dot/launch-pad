import type { OpenAIResponse } from "@/lib/server/generate-site-style";

export type ExtractedOpenAIUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/** Clamps a raw provider-reported count to a non-negative integer. */
function normaliseTokenCount(value: number): number {
  return Math.max(0, Math.trunc(value));
}

/**
 * Returns null whenever the provider did not supply usable usage — a network
 * or HTTP failure, or a malformed payload — so callers never fabricate a
 * cost row from missing data (issue #368).
 */
export function extractOpenAIUsage(response: OpenAIResponse | null | undefined): ExtractedOpenAIUsage | null {
  const usage = response?.usage;
  if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") {
    return null;
  }
  if (!Number.isFinite(usage.input_tokens) || !Number.isFinite(usage.output_tokens)) return null;

  const inputTokens = normaliseTokenCount(usage.input_tokens);
  const outputTokens = normaliseTokenCount(usage.output_tokens);

  // Clamped to inputTokens: a malformed compatible-provider payload could
  // otherwise report more cached tokens than input tokens, which would make
  // calculateUncachedInputTokens's "input minus cached" charge more cached
  // tokens than were actually sent.
  const cached = usage.input_tokens_details?.cached_tokens;
  const cachedInputTokens =
    typeof cached === "number" && Number.isFinite(cached) ? Math.min(normaliseTokenCount(cached), inputTokens) : 0;

  const totalTokens =
    typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens)
      ? normaliseTokenCount(usage.total_tokens)
      : inputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
  };
}

/** Web search has a separate per-call price, so completed calls are counted directly from the output items. */
export function countCompletedWebSearchCalls(response: OpenAIResponse | null | undefined): number {
  return (response?.output || []).filter((item) => item.type === "web_search_call" && item.status === "completed").length;
}

export function extractOpenAIModel(response: OpenAIResponse | null | undefined, fallbackModel: string): string {
  return typeof response?.model === "string" && response.model.trim() ? response.model.trim() : fallbackModel;
}
