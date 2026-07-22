import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/generation-status/route";
import { VERCEL_OIDC_HEADER } from "@/lib/server/ai-responses-runtime";

const KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_VISION_MODEL",
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_MODEL",
  "VERCEL_OIDC_TOKEN",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

function clearAIEnvironment() {
  for (const key of KEYS) delete process.env[key];
}

function request(oidcToken = "") {
  return new Request("https://hoodlums.dev/api/generation-status", {
    headers: oidcToken ? { [VERCEL_OIDC_HEADER]: oidcToken } : {},
  });
}

describe("GET /api/generation-status", () => {
  beforeEach(clearAIEnvironment);

  afterEach(() => {
    clearAIEnvironment();
    for (const key of KEYS) {
      const value = original[key];
      if (value !== undefined) process.env[key] = value;
    }
  });

  it("reports direct OpenAI readiness without exposing the credential", async () => {
    process.env.OPENAI_API_KEY = "secret-openai-key";
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ready: true, provider: "openai", model: "gpt-5-mini" });
    expect(JSON.stringify(body)).not.toContain("secret-openai-key");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reports Vercel AI Gateway readiness from the automatic function OIDC header", async () => {
    const response = await GET(request("secret-runtime-oidc-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ready: true,
      provider: "vercel-ai-gateway",
      model: "openai/gpt-5-mini",
    });
    expect(JSON.stringify(body)).not.toContain("secret-runtime-oidc-token");
  });

  it("still supports a locally pulled or build-time OIDC environment token", async () => {
    process.env.VERCEL_OIDC_TOKEN = "secret-environment-oidc-token";
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ready: true,
      provider: "vercel-ai-gateway",
    });
  });

  it("returns 503 when no AI authentication is present", async () => {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ready: false, provider: null, model: null });
  });
});
