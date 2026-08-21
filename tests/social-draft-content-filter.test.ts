import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/social/draft/route";
import { resetGenerateSiteStyleRateLimitForTests } from "@/lib/server/api-protection";

function request(body: unknown): Request {
  return new Request("http://localhost/api/social/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    walletAddress: "0x1111111111111111111111111111111111111111",
    project: { name: "Test Coin", ticker: "TEST", description: "A community-driven meme token." },
    angleIndex: 1,
    ...overrides,
  };
}

function providerResponse(draft: { xText: string; telegramText: string }): Response {
  return new Response(
    JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(draft) }] }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const CLEAN_DRAFT = { xText: "Test Coin keeps building steadily.", telegramText: "Come hang with the Test Coin crew." };
const POISONED_DRAFT = { xText: "This nigger coin is pumping right now.", telegramText: "Come hang with the crew." };

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

describe("POST /api/social/draft content filter (issue #392)", () => {
  it("rejects a slur in the project description before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request(draftInput({ project: { name: "Test Coin", ticker: "TEST", description: "A nigger coin for the community." } })),
    );
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(400);
    expect(body.error).toContain("description");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a clean draft straight through", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(providerResponse(CLEAN_DRAFT));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(draftInput()));
    const body = await responseJson<{ draft: { xText: string } }>(response);

    expect(response.status).toBe(200);
    expect(body.draft.xText).toBe(CLEAN_DRAFT.xText);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once with corrective feedback when the first draft fails the content filter, and succeeds if the retry is clean", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(providerResponse(POISONED_DRAFT)).mockResolvedValueOnce(providerResponse(CLEAN_DRAFT));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(draftInput()));
    const body = await responseJson<{ draft: { xText: string } }>(response);

    expect(response.status).toBe(200);
    expect(body.draft.xText).toBe(CLEAN_DRAFT.xText);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never returns a draft when both the first attempt and the corrective retry fail the content filter (issue #364 fail-open bug class)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(providerResponse(POISONED_DRAFT)).mockResolvedValueOnce(providerResponse(POISONED_DRAFT));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(draftInput()));
    const body = await responseJson<{ error?: string; draft?: unknown }>(response);

    expect(response.status).toBe(502);
    expect(body.draft).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes crude but allowed content", async () => {
    const allowedDraft = {
      xText: "fuck the bear market, degenerates unite behind Test Coin.",
      telegramText: "This shitcoin is for adults only, join the crew.",
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(providerResponse(allowedDraft));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(draftInput()));
    expect(response.status).toBe(200);
  });
});
