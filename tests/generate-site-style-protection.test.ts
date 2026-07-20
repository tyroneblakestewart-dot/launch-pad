import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-style/route";
import {
  GENERATE_SITE_STYLE_HEADER,
  GENERATE_SITE_STYLE_LIMIT,
  consumeGenerateSiteStyleRateLimit,
  getClientIp,
  isGenerateSiteStyleRequestAuthorised,
  resetGenerateSiteStyleRateLimitForTests,
} from "@/lib/server/api-protection";

const SECRET = "hoodlums-test-secret";
const ORIGIN = "https://hoodlums.dev";
const IP = "203.0.113.42";

function request(headers: Record<string, string> = {}) {
  return new Request("https://hoodlums.dev/api/generate-site-style", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Forwarded-For": IP,
      ...headers,
    },
    body: JSON.stringify({ imageDataUrl: "data:image/png;base64,aGVsbG8=" }),
  });
}

beforeEach(() => {
  process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
  process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
  delete process.env.OPENAI_API_KEY;
  resetGenerateSiteStyleRateLimitForTests();
});

afterEach(() => {
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  delete process.env.OPENAI_API_KEY;
  resetGenerateSiteStyleRateLimitForTests();
  vi.restoreAllMocks();
});

describe("generate-site-style API protection helpers", () => {
  it("extracts the first forwarded IP and falls back safely", () => {
    expect(getClientIp(request({ "X-Forwarded-For": "198.51.100.7, 10.0.0.1" }))).toBe("198.51.100.7");
    expect(getClientIp(new Request("https://hoodlums.dev", { headers: { "X-Real-IP": "192.0.2.8" } }))).toBe("192.0.2.8");
    expect(getClientIp(new Request("https://hoodlums.dev"))).toBe("unknown");
  });

  it("requires both the configured origin and timing-safe shared secret", () => {
    expect(isGenerateSiteStyleRequestAuthorised(
      request({ [GENERATE_SITE_STYLE_HEADER]: SECRET }),
      SECRET,
      ORIGIN,
    )).toBe(true);
    expect(isGenerateSiteStyleRequestAuthorised(request(), SECRET, ORIGIN)).toBe(false);
    expect(isGenerateSiteStyleRequestAuthorised(
      request({ [GENERATE_SITE_STYLE_HEADER]: "wrong" }),
      SECRET,
      ORIGIN,
    )).toBe(false);
    expect(isGenerateSiteStyleRequestAuthorised(
      new Request("https://hoodlums.dev", {
        headers: { Origin: "https://evil.example", [GENERATE_SITE_STYLE_HEADER]: SECRET },
      }),
      SECRET,
      ORIGIN,
    )).toBe(false);
  });

  it("resets expired windows and blocks the eleventh request", () => {
    const start = 1_000_000;
    for (let index = 0; index < GENERATE_SITE_STYLE_LIMIT; index += 1) {
      expect(consumeGenerateSiteStyleRateLimit(IP, start).allowed).toBe(true);
    }
    expect(consumeGenerateSiteStyleRateLimit(IP, start).allowed).toBe(false);
    expect(consumeGenerateSiteStyleRateLimit(IP, start + 60 * 60 * 1000).allowed).toBe(true);
  });
});

describe("POST /api/generate-site-style protection", () => {
  it("rejects missing or invalid credentials with 401 before any upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const headers of [
      {},
      { [GENERATE_SITE_STYLE_HEADER]: "wrong" },
      { [GENERATE_SITE_STYLE_HEADER]: SECRET, Origin: "https://evil.example" },
    ]) {
      const response = await POST(request(headers));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorised artwork-generation request." });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows ten authenticated requests per IP then returns 429 with rate headers", async () => {
    const authenticated = { [GENERATE_SITE_STYLE_HEADER]: SECRET };

    for (let index = 0; index < GENERATE_SITE_STYLE_LIMIT; index += 1) {
      const response = await POST(request(authenticated));
      expect(response.status).toBe(503);
      expect(response.headers.get("RateLimit-Limit")).toBe(String(GENERATE_SITE_STYLE_LIMIT));
      expect(response.headers.get("RateLimit-Remaining")).toBe(String(GENERATE_SITE_STYLE_LIMIT - index - 1));
    }

    const blocked = await POST(request(authenticated));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("RateLimit-Remaining")).toBe("0");
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await blocked.json()).toEqual({
      error: "Artwork generation rate limit exceeded. Try again later.",
    });
  });
});
