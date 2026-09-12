import { describe, expect, it } from "vitest";
import { countCompletedWebSearchCalls, extractOpenAIModel, extractOpenAIUsage } from "@/lib/server/ai-usage";

describe("extractOpenAIUsage", () => {
  it("extracts input/cached/output/total tokens from a well-formed usage payload", () => {
    const usage = extractOpenAIUsage({
      usage: {
        input_tokens: 1200,
        input_tokens_details: { cached_tokens: 300 },
        output_tokens: 450,
        total_tokens: 1650,
      },
    });
    expect(usage).toEqual({ inputTokens: 1200, cachedInputTokens: 300, outputTokens: 450, reasoningTokens: 0, totalTokens: 1650 });
  });

  // A reasoning model's hidden thinking counts against the same
  // max_output_tokens as its visible answer, so this is the figure that
  // explains a page that came back empty (owner report, 12 Sep 2026).
  it("extracts reasoning tokens from output_tokens_details, defaulting to 0 and never exceeding output tokens", () => {
    const withReasoning = extractOpenAIUsage({
      usage: { input_tokens: 9_000, output_tokens: 31_950, output_tokens_details: { reasoning_tokens: 31_400 }, total_tokens: 40_950 },
    });
    expect(withReasoning?.outputTokens).toBe(31_950);
    expect(withReasoning?.reasoningTokens).toBe(31_400);

    const none = extractOpenAIUsage({ usage: { input_tokens: 100, output_tokens: 50 } });
    expect(none?.reasoningTokens).toBe(0);

    const overReported = extractOpenAIUsage({
      usage: { input_tokens: 100, output_tokens: 50, output_tokens_details: { reasoning_tokens: 500 } },
    });
    expect(overReported?.reasoningTokens).toBe(50);

    const malformed = extractOpenAIUsage({
      usage: { input_tokens: 100, output_tokens: 50, output_tokens_details: { reasoning_tokens: Number.NaN } },
    });
    expect(malformed?.reasoningTokens).toBe(0);
  });

  it("defaults cached tokens to 0 when absent", () => {
    const usage = extractOpenAIUsage({ usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
    expect(usage?.cachedInputTokens).toBe(0);
  });

  it("derives total tokens from input+output when total_tokens is missing", () => {
    const usage = extractOpenAIUsage({ usage: { input_tokens: 100, output_tokens: 50 } });
    expect(usage?.totalTokens).toBe(150);
  });

  it("returns null (never fabricates) when usage is missing entirely", () => {
    expect(extractOpenAIUsage({})).toBeNull();
    expect(extractOpenAIUsage(null)).toBeNull();
    expect(extractOpenAIUsage(undefined)).toBeNull();
  });

  it("returns null for malformed usage (non-numeric or missing required fields)", () => {
    expect(extractOpenAIUsage({ usage: { input_tokens: "a lot", output_tokens: 50 } as never })).toBeNull();
    expect(extractOpenAIUsage({ usage: { input_tokens: 100 } as never })).toBeNull();
    expect(extractOpenAIUsage({ usage: { input_tokens: Number.NaN, output_tokens: 50 } })).toBeNull();
  });

  it("clamps a negative cached-token value to 0 rather than trusting it", () => {
    const usage = extractOpenAIUsage({ usage: { input_tokens: 100, input_tokens_details: { cached_tokens: -5 }, output_tokens: 50 } });
    expect(usage?.cachedInputTokens).toBe(0);
  });

  it("clamps a malformed cached-token count above input tokens down to input tokens (issue #368 correction pass)", () => {
    const usage = extractOpenAIUsage({
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 500 }, output_tokens: 50 },
    });
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.cachedInputTokens).toBe(100);
  });

  it("truncates non-integer provider token counts to non-negative integers", () => {
    const usage = extractOpenAIUsage({
      usage: {
        input_tokens: 100.9,
        input_tokens_details: { cached_tokens: 40.5 },
        output_tokens: 50.4,
        total_tokens: 150.9,
      },
    });
    expect(usage).toEqual({ inputTokens: 100, cachedInputTokens: 40, outputTokens: 50, reasoningTokens: 0, totalTokens: 150 });
  });
});

describe("countCompletedWebSearchCalls", () => {
  it("counts only completed web_search_call output items", () => {
    const count = countCompletedWebSearchCalls({
      output: [
        { type: "web_search_call", status: "completed" },
        { type: "web_search_call", status: "in_progress" },
        { type: "message", status: "completed" },
        { type: "web_search_call", status: "completed" },
      ],
    });
    expect(count).toBe(2);
  });

  it("is 0 when there is no output", () => {
    expect(countCompletedWebSearchCalls({})).toBe(0);
    expect(countCompletedWebSearchCalls(null)).toBe(0);
  });
});

describe("extractOpenAIModel", () => {
  it("returns the response's model when present", () => {
    expect(extractOpenAIModel({ model: "gpt-5-mini-2026-01-01" }, "gpt-5-mini")).toBe("gpt-5-mini-2026-01-01");
  });

  it("falls back to the requested model when the response omits it", () => {
    expect(extractOpenAIModel({}, "gpt-5-mini")).toBe("gpt-5-mini");
    expect(extractOpenAIModel(null, "gpt-5-mini")).toBe("gpt-5-mini");
  });
});
