import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/social/voice-profile/route";
import { resetGenerateSiteStyleRateLimitForTests } from "@/lib/server/api-protection";

function request(body: unknown): Request {
  return new Request("http://localhost/api/social/voice-profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    walletAddress: "0x1111111111111111111111111111111111111111",
    project: { name: "Test Coin", ticker: "TEST" },
    examples: ["gm frens, big week ahead for Test Coin", "we keep building no matter what the market does"],
    ...overrides,
  };
}

const CLEAN_PROFILE = {
  tone: "confident and playful, community-first",
  vocabulary: "crypto-native slang without jargon overload",
  cadence: "short punchy sentences with occasional fragments",
  emojiHabits: "one emoji max, rarely more than that",
  sampleLines: ["gm frens, lets go", "building steady, no noise", "community first always"],
};

function providerResponse(profile: unknown): Response {
  return new Response(
    JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(profile) }] }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  resetGenerateSiteStyleRateLimitForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/social/voice-profile content filter (issue #392)", () => {
  it("rejects a slur in a pasted example before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input({ examples: ["this nigger coin is pumping", "gm frens"] })));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("examples");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects generated profile output that fails the content safety filter", async () => {
    const poisoned = { ...CLEAN_PROFILE, tone: "confident, kike energy all day" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(providerResponse(poisoned)));

    const response = await POST(request(input()));
    expect(response.status).toBe(502);
  });

  it("passes clean input and output through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(providerResponse(CLEAN_PROFILE)));

    const response = await POST(request(input()));
    expect(response.status).toBe(200);
  });
});
