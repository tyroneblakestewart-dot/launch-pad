import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-style/route";
import {
  ARTWORK_SITE_STYLE_SCHEMA,
  MAX_STYLE_IMAGE_DATA_URL_LENGTH,
  buildArtworkStylePrompt,
  buildOpenAIStyleRequest,
  extractOpenAIOutputText,
  normalizeGenerateSiteStyleInput,
  parseOpenAIStyle,
} from "@/lib/server/generate-site-style";

const VALID_IMAGE = "data:image/png;base64,AAAA";
const VALID_STYLE = {
  background: "#050706",
  surface: "#101411",
  text: "#F4F7EF",
  muted: "#AAB2AA",
  primary: "#BCE759",
  secondary: "#91C738",
  accent: "#E8C435",
  layout: "split",
  mood: "bold",
  texture: "grain",
  radius: "soft",
  eyebrow: "BUILD THE CREW",
  headline: "A token website shaped by the artwork.",
  cta: "JOIN $HOOD",
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/generate-site-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generate-site-style helpers", () => {
  it("normalizes valid data and applies safe defaults", () => {
    const result = normalizeGenerateSiteStyleInput({ imageDataUrl: VALID_IMAGE });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Untitled token",
        ticker: "TOKEN",
        description: "Community token project",
        imageDataUrl: VALID_IMAGE,
      },
    });
  });

  it("trims and limits user-controlled fields", () => {
    const result = normalizeGenerateSiteStyleInput({
      name: `  ${"N".repeat(50)}  `,
      ticker: `  ${"T".repeat(20)}  `,
      description: `  ${"D".repeat(520)}  `,
      imageDataUrl: `  ${VALID_IMAGE}  `,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toHaveLength(40);
    expect(result.value.ticker).toHaveLength(12);
    expect(result.value.description).toHaveLength(500);
    expect(result.value.imageDataUrl).toBe(VALID_IMAGE);
  });

  it("rejects missing, malformed and oversized image data", () => {
    expect(normalizeGenerateSiteStyleInput(null)).toEqual({
      ok: false,
      error: "A valid optimised artwork image is required.",
    });
    expect(normalizeGenerateSiteStyleInput({ imageDataUrl: "https://example.com/art.png" })).toEqual({
      ok: false,
      error: "A valid optimised artwork image is required.",
    });

    const prefix = "data:image/png;base64,";
    const exactLimit = prefix + "A".repeat(MAX_STYLE_IMAGE_DATA_URL_LENGTH - prefix.length);
    expect(normalizeGenerateSiteStyleInput({ imageDataUrl: exactLimit }).ok).toBe(true);
    expect(normalizeGenerateSiteStyleInput({ imageDataUrl: `${exactLimit}A` })).toEqual({
      ok: false,
      error: "A valid optimised artwork image is required.",
    });
  });

  it("builds the constrained artwork prompt", () => {
    const prompt = buildArtworkStylePrompt({
      name: "Hoodlums",
      ticker: "HOOD",
      description: "A community launch.",
      imageDataUrl: VALID_IMAGE,
    });
    expect(prompt).toContain("Project name: Hoodlums");
    expect(prompt).toContain("Ticker: HOOD");
    expect(prompt).toContain("Do not make financial promises.");
    expect(prompt).toContain("Do not default to hacker, matrix, Robin Hood, green, graffiti or Hoodlums styling");
  });

  it("builds the OpenAI request with the strict schema and selected model", () => {
    const input = {
      name: "Hoodlums",
      ticker: "HOOD",
      description: "A community launch.",
      imageDataUrl: VALID_IMAGE,
    };
    const request = buildOpenAIStyleRequest(input, "vision-test-model");
    expect(request.model).toBe("vision-test-model");
    expect(request.store).toBe(false);
    expect(request.text.format.schema).toBe(ARTWORK_SITE_STYLE_SCHEMA);
    expect(request.input[0].content[1]).toEqual({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "low",
    });
  });

  it("extracts the first output_text item and ignores unrelated content", () => {
    expect(
      extractOpenAIOutputText({
        output: [
          { content: [{ type: "refusal", text: "ignore" }] },
          { content: [{ type: "output_text", text: "accepted" }] },
        ],
      }),
    ).toBe("accepted");
    expect(extractOpenAIOutputText({})).toBe("");
  });

  it("parses object output and rejects empty, malformed, array and primitive output", () => {
    expect(
      parseOpenAIStyle({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_STYLE) }] }],
      }),
    ).toEqual(VALID_STYLE);
    expect(parseOpenAIStyle({})).toBeNull();
    expect(
      parseOpenAIStyle({ output: [{ content: [{ type: "output_text", text: "not-json" }] }] }),
    ).toBeNull();
    expect(
      parseOpenAIStyle({ output: [{ content: [{ type: "output_text", text: "[]" }] }] }),
    ).toBeNull();
    expect(
      parseOpenAIStyle({ output: [{ content: [{ type: "output_text", text: "12" }] }] }),
    ).toBeNull();
  });
});

describe("POST /api/generate-site-style", () => {
  it("rejects requests when the server-side OpenAI credential is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      error: "AI style generation is not configured. The browser artwork matcher will be used.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with status 400", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const response = await POST(makeRequest("{"));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "Invalid request body." });
  });

  it("rejects missing artwork with status 400 and never contacts OpenAI", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(makeRequest({ name: "No artwork" }));
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "A valid optimised artwork image is required." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a generated style for valid input without touching real OpenAI data", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_VISION_MODEL", "vision-test-model");
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
        name: " Hoodlums ",
        ticker: " HOOD ",
        description: " Community launch. ",
        imageDataUrl: VALID_IMAGE,
      }),
    );

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ style: { ...VALID_STYLE, source: "openai" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    const outbound = JSON.parse(String(init.body)) as {
      model: string;
      input: Array<{ content: Array<{ text?: string }> }>;
    };
    expect(outbound.model).toBe("vision-test-model");
    expect(outbound.input[0].content[0].text).toContain("Project name: Hoodlums");
  });

  it("uses the default model when no model override is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_VISION_MODEL", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: JSON.stringify(VALID_STYLE) }] }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(String(init.body)) as { model: string }).model).toBe("gpt-5-mini");
  });

  it("maps an upstream HTTP failure to a safe 502 response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));

    const response = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({
      error: "AI analysis was unavailable. The browser artwork matcher will be used.",
    });
  });

  it("maps a network failure to a safe 502 response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    const response = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({
      error: "AI analysis was unavailable. The browser artwork matcher will be used.",
    });
  });

  it("rejects non-JSON and structurally invalid AI output", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const invalidJsonResponse = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    expect(invalidJsonResponse.status).toBe(502);
    expect(await json(invalidJsonResponse)).toEqual({
      error: "AI returned an invalid design. The browser artwork matcher will be used.",
    });

    const missingOutputResponse = await POST(makeRequest({ imageDataUrl: VALID_IMAGE }));
    expect(missingOutputResponse.status).toBe(502);
    expect(await json(missingOutputResponse)).toEqual({
      error: "AI returned an invalid design. The browser artwork matcher will be used.",
    });
  });
});
