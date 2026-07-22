import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENAI_RESPONSES_URL,
  VERCEL_AI_GATEWAY_RESPONSES_URL,
  resolveAIResponsesRuntime,
} from "@/lib/server/ai-responses-runtime";

const ROOT = process.cwd();

describe("AI Responses runtime selection", () => {
  it("prefers a direct OpenAI key when one is configured", () => {
    expect(
      resolveAIResponsesRuntime({
        OPENAI_API_KEY: "openai-key",
        OPENAI_VISION_MODEL: "openai/gpt-5-mini",
      }),
    ).toEqual({
      apiKey: "openai-key",
      responsesUrl: OPENAI_RESPONSES_URL,
      model: "gpt-5-mini",
      source: "openai",
    });
  });

  it("uses an explicit Vercel AI Gateway key when OpenAI is unavailable", () => {
    expect(
      resolveAIResponsesRuntime({
        AI_GATEWAY_API_KEY: "gateway-key",
        OPENAI_VISION_MODEL: "gpt-5-mini",
      }),
    ).toEqual({
      apiKey: "gateway-key",
      responsesUrl: VERCEL_AI_GATEWAY_RESPONSES_URL,
      model: "openai/gpt-5-mini",
      source: "vercel-ai-gateway",
    });
  });

  it("uses the automatic Vercel OIDC token without a manually configured provider key", () => {
    expect(
      resolveAIResponsesRuntime({
        VERCEL_OIDC_TOKEN: "vercel-oidc-token",
        AI_GATEWAY_MODEL: "openai/gpt-5-mini",
      }),
    ).toEqual({
      apiKey: "vercel-oidc-token",
      responsesUrl: VERCEL_AI_GATEWAY_RESPONSES_URL,
      model: "openai/gpt-5-mini",
      source: "vercel-ai-gateway",
    });
  });

  it("returns null only when no direct or gateway authentication exists", () => {
    expect(resolveAIResponsesRuntime({})).toBeNull();
  });

  it("wires the full website endpoint to the runtime selector instead of requiring OPENAI_API_KEY", async () => {
    const route = await readFile(
      path.join(ROOT, "app", "api", "generate-site-page", "route.ts"),
      "utf8",
    );

    expect(route).toContain("resolveAIResponsesRuntime");
    expect(route).toContain("requestOpenAI(ai,");
    expect(route).not.toContain("const apiKey = process.env.OPENAI_API_KEY");
    expect(route).not.toContain('const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"');
  });
});
