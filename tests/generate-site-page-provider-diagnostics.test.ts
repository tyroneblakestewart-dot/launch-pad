import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/route";

describe("POST /api/generate-site-page provider diagnostics", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a sanitized stage, provider, status and upstream detail for artwork failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Unsupported image request. Bearer secret-provider-token",
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await POST(
      new Request("https://hoodlums.dev/api/generate-site-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Journey",
          ticker: "RIDE",
          description: "A London journey community project with enough detail for generation.",
          imageDataUrl: "data:image/jpeg;base64,aGVsbG8=",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toContain("artwork could not be analysed");
    expect(body.providerError).toMatchObject({
      stage: "page-artwork-analysis",
      provider: "openai",
      kind: "http",
      status: 400,
    });
    expect(body.providerError.detail).toContain("Unsupported image request");
    expect(JSON.stringify(body)).not.toContain("secret-provider-token");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
