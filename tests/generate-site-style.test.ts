import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-style/route";
import {
  MAX_IMAGE_DATA_URL_LENGTH,
  SITE_STYLE_BACKEND_ADAPTER,
  TOKEN_LANDING_PAGE_GENERATOR_PREFIX,
  buildOpenAIRequestBody,
  buildSiteStylePrompt,
  didUseInspirationSearch,
  extractOutputText,
  isSiteStyle,
  isValidImageDataUrl,
  normaliseGenerateSiteStyleRequest,
  parseSiteStyleResponse,
  type OpenAIResponse,
  type SiteStyle,
} from "@/lib/server/generate-site-style";
import { VALID_STYLE } from "./site-style-fixture";

const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/generate-site-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe("generate-site-style server functions", () => {
  it("normalises missing values and limits user-controlled text", () => {
    const result = normaliseGenerateSiteStyleRequest({
      name: `  ${"N".repeat(60)}  `,
      ticker: `  ${"T".repeat(20)}  `,
      description: `  ${"D".repeat(600)}  `,
      imageDataUrl: VALID_IMAGE,
    });

    expect(result.name).toHaveLength(40);
    expect(result.ticker).toHaveLength(12);
    expect(result.description).toHaveLength(500);
    expect(result.imageDataUrl).toBe(VALID_IMAGE);

    expect(normaliseGenerateSiteStyleRequest({})).toEqual({
      name: "Untitled token",
      ticker: "TOKEN",
      description: "Community token project",
      imageDataUrl: "",
      inspirationUrl: "",
    });
  });

  it("validates image data URLs and rejects oversized input", () => {
    expect(isValidImageDataUrl(VALID_IMAGE)).toBe(true);
    expect(isValidImageDataUrl("https://example.com/image.png")).toBe(false);
    expect(isValidImageDataUrl(undefined)).toBe(false);
    expect(
      isValidImageDataUrl(`data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_LENGTH)}`),
    ).toBe(false);
  });

  it("keeps the private creative brief and requires visible design and copy decisions", () => {
    expect(TOKEN_LANDING_PAGE_GENERATOR_PREFIX).toContain(
      "You are a token landing page generator",
    );
    expect(TOKEN_LANDING_PAGE_GENERATOR_PREFIX).toContain(
      "STEP 1 — ANALYSE THE IMAGE FIRST",
    );
    expect(SITE_STYLE_BACKEND_ADAPTER).toContain(
      "must never be displayed in the user interface",
    );
    expect(SITE_STYLE_BACKEND_ADAPTER).toContain(
      "MUST inspect it with web search before answering",
    );
    expect(SITE_STYLE_BACKEND_ADAPTER).toContain(
      "fontStyle, heroTreatment, motionStyle",
    );
    expect(SITE_STYLE_BACKEND_ADAPTER).toContain(
      "Output only the schema-compliant JSON object",
    );
  });

  it("builds a high-detail structured request without a web tool when no URL is supplied", () => {
    const input = normaliseGenerateSiteStyleRequest({
      name: "Hoodlums",
      ticker: "HOOD",
      description: "Community launch",
      imageDataUrl: VALID_IMAGE,
    });
    const prompt = buildSiteStylePrompt(input);
    const request = buildOpenAIRequestBody(input, "test-model");

    expect(prompt).toContain("Project name: Hoodlums");
    expect(prompt).toContain("Ticker: HOOD");
    expect(prompt).toContain("Do not ask questions");
    expect(request.model).toBe("test-model");
    expect(request.store).toBe(false);
    expect(request.max_output_tokens).toBe(1_700);
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("tool_choice");
    expect(request.input).toHaveLength(2);
    expect(request.input[0].role).toBe("developer");
    expect(request.input[1].content[1]).toEqual({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "high",
    });
    expect(request.text.format.strict).toBe(true);
    expect(request.text.format.schema.required).toContain("heroTreatment");
    expect(request.text.format.schema.required).toContain("roadmap");
  });

  it("extracts output text and verifies completed web-search calls", () => {
    const payload: OpenAIResponse = {
      output: [
        { type: "web_search_call", status: "completed" },
        { content: [{ type: "reasoning", text: "ignore" }] },
        { content: [{ type: "output_text", text: "result" }] },
      ],
    };
    expect(extractOutputText(payload)).toBe("result");
    expect(didUseInspirationSearch(payload)).toBe(true);
    expect(didUseInspirationSearch({ output: [{ type: "web_search_call", status: "failed" }] })).toBe(false);
    expect(didUseInspirationSearch({})).toBe(false);
  });

  it("accepts only complete styles with design, content and exactly three roadmap items", () => {
    expect(isSiteStyle(VALID_STYLE)).toBe(true);
    expect(isSiteStyle({ ...VALID_STYLE, primary: "green" })).toBe(false);
    expect(isSiteStyle({ ...VALID_STYLE, fontStyle: "unknown" })).toBe(false);
    expect(isSiteStyle({ ...VALID_STYLE, heroBody: "short" })).toBe(false);
    expect(isSiteStyle({ ...VALID_STYLE, roadmap: VALID_STYLE.roadmap.slice(0, 2) })).toBe(false);
    expect(isSiteStyle(null)).toBe(false);
  });

  it("parses valid structured output and rejects malformed or incomplete output", () => {
    expect(
      parseSiteStyleResponse({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_STYLE) }] }],
      }),
    ).toEqual(VALID_STYLE);
    expect(
      parseSiteStyleResponse({
        output: [{ content: [{ type: "output_text", text: "not-json" }] }],
      }),
    ).toBeNull();
    expect(
      parseSiteStyleResponse({
        output: [{ content: [{ type: "output_text", text: JSON.stringify({ primary: "#BCE759" }) }] }],
      }),
    ).toBeNull();
  });
});

describe("POST /api/generate-site-style", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.OPENAI_VISION_MODEL;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_VISION_MODEL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects requests when the server-side OpenAI credential is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(503);
    expect(body.error).toContain("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const request = new Request("http://localhost/api/generate-site-style", {
      method: "POST",
      body: "{",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({ error: "Invalid request body." });
  });

  it("rejects missing, remote and oversized artwork", async () => {
    for (const imageDataUrl of [
      undefined,
      "https://example.com/image.png",
      `data:image/png;base64,${"A".repeat(MAX_IMAGE_DATA_URL_LENGTH)}`,
    ]) {
      const response = await POST(makeRequest({ imageDataUrl }));
      expect(response.status).toBe(400);
      expect(await responseJson(response)).toEqual({
        error: "A valid optimised artwork image is required.",
      });
    }
  });

  it("returns a full validated artwork-only style and accurate inspiration metadata", async () => {
    process.env.OPENAI_VISION_MODEL = "vision-test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_STYLE) }] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      makeRequest({
        name: "Hoodlums",
        ticker: "HOOD",
        description: "A community token launch.",
        imageDataUrl: VALID_IMAGE,
      }),
    );
    const body = await responseJson<{
      style: SiteStyle & { source: string; inspirationUsed: boolean };
    }>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.style).toEqual({ ...VALID_STYLE, source: "openai", inspirationUsed: false });
    expect(JSON.stringify(body)).not.toContain("You are a token landing page generator");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-openai-key");
    const outbound = JSON.parse(String(init.body)) as {
      model: string;
      store: boolean;
      input: Array<{ role: string; content: Array<{ type: string; text?: string; detail?: string }> }>;
    };
    expect(outbound).toMatchObject({ model: "vision-test-model", store: false });
    expect(outbound.input[0].role).toBe("developer");
    expect(outbound.input[1].content[1]).toMatchObject({
      type: "input_image",
      detail: "high",
    });
  });

  it("returns 502 when OpenAI responds with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("upstream failed", { status: 429 })),
    );

    const response = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    expect(response.status).toBe(502);
    expect((await responseJson<{ error: string }>(response)).error).toContain("unavailable");
  });

  it("returns 502 when the upstream request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const response = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    expect(response.status).toBe(502);
    expect((await responseJson<{ error: string }>(response)).error).toContain("unavailable");
  });

  it("returns 502 for non-JSON, malformed or schema-invalid OpenAI output", async () => {
    const responses = [
      new Response("not-json", { status: 200 }),
      new Response(
        JSON.stringify({ output: [{ content: [{ type: "output_text", text: "not-json" }] }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                { type: "output_text", text: JSON.stringify({ ...VALID_STYLE, cta: "x" }) },
              ],
            },
          ],
        }),
      ),
    ];

    for (const upstream of responses) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream));
      const response = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
      expect(response.status).toBe(502);
      expect((await responseJson<{ error: string }>(response)).error).toContain("invalid design");
      vi.unstubAllGlobals();
    }
  });
});
