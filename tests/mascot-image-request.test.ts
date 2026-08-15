import { describe, expect, it, vi } from "vitest";
import type { AIResponsesRuntime } from "@/lib/server/ai-responses-runtime";
import { requestMascotImage } from "@/lib/server/mascot-image-request";

const OPENAI_RUNTIME: AIResponsesRuntime = {
  apiKey: "test-key",
  responsesUrl: "https://api.openai.com/v1/responses",
  model: "gpt-5-mini",
  source: "openai",
};

const GATEWAY_RUNTIME: AIResponsesRuntime = {
  apiKey: "gateway-key",
  responsesUrl: "https://ai-gateway.vercel.sh/v1/responses",
  model: "openai/gpt-5-mini",
  source: "vercel-ai-gateway",
};

describe("requestMascotImage", () => {
  it("fails closed as unsupported-provider on the Vercel AI Gateway fallback, without making a request", async () => {
    const fetchMock = vi.fn();
    const result = await requestMascotImage(GATEWAY_RUNTIME, "a prompt", fetchMock);
    expect(result).toEqual({ ok: false, kind: "unsupported-provider" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the OpenAI images endpoint directly and returns a data URL on success", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/images/generations");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
      return new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 });
    });
    const result = await requestMascotImage(OPENAI_RUNTIME, "a prompt", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: true, imageDataUrl: "data:image/png;base64,AAAA" });
  });

  it("returns a network failure when the fetch itself throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await requestMascotImage(OPENAI_RUNTIME, "a prompt", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, kind: "network" });
  });

  it("returns an http failure on a non-ok response", async () => {
    const fetchMock = vi.fn(async () => new Response("server error", { status: 500 }));
    const result = await requestMascotImage(OPENAI_RUNTIME, "a prompt", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, kind: "http" });
  });

  it("returns invalid when the response has no b64_json image", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const result = await requestMascotImage(OPENAI_RUNTIME, "a prompt", fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, kind: "invalid" });
  });
});
