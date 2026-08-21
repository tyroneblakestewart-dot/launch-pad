import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as visualDnaPost } from "@/app/api/social/mascot/visual-dna/route";
import { POST as imagePost } from "@/app/api/social/mascot/image/route";
import { resetGenerateSiteStyleRateLimitForTests } from "@/lib/server/api-protection";

const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CLEAN_VISUAL_DNA = {
  characterDescription: "A friendly rounded mascot with big eyes and a warm confident smile",
  colourPalette: "Soft peach, warm cream and cocoa brown with a mint accent",
  signatureProps: "A tiny crown and a rounded badge",
  artStyle: "Rounded, playful, approachable illustration style",
};

function providerResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }] }),
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

describe("POST /api/social/mascot/visual-dna content filter (issue #392)", () => {
  it("rejects a slur in the project name before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await visualDnaPost(
      request("/api/social/mascot/visual-dna", {
        walletAddress: "0x1111111111111111111111111111111111111111",
        project: { name: "nigger coin", ticker: "TEST" },
        imageDataUrl: VALID_IMAGE,
      }),
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects generated visual-DNA output that fails the content safety filter", async () => {
    const poisoned = { ...CLEAN_VISUAL_DNA, characterDescription: "A kike-themed mascot with a big smile and props" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(providerResponse(poisoned)));

    const response = await visualDnaPost(
      request("/api/social/mascot/visual-dna", {
        walletAddress: "0x1111111111111111111111111111111111111111",
        project: { name: "Test Coin", ticker: "TEST" },
        imageDataUrl: VALID_IMAGE,
      }),
    );
    expect(response.status).toBe(502);
  });

  it("passes clean input and output through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(providerResponse(CLEAN_VISUAL_DNA)));

    const response = await visualDnaPost(
      request("/api/social/mascot/visual-dna", {
        walletAddress: "0x1111111111111111111111111111111111111111",
        project: { name: "Test Coin", ticker: "TEST" },
        imageDataUrl: VALID_IMAGE,
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("POST /api/social/mascot/image content filter (issue #392)", () => {
  it("rejects a slur in the scene description before generating an image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await imagePost(
      request("/api/social/mascot/image", {
        walletAddress: "0x1111111111111111111111111111111111111111",
        project: { name: "Test Coin", ticker: "TEST" },
        mascotVisualDNA: CLEAN_VISUAL_DNA,
        sceneInput: "the mascot holding up a chink coin",
      }),
    );
    const body = await responseJson<{ error: string }>(response);
    expect(response.status).toBe(400);
    expect(body.error).toContain("sceneInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
