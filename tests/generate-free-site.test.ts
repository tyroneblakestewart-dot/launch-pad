import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-free-site/route";
import {
  FREE_SITE_COPY_KEYS,
  type FREE_SITE_DESIGN_SCHEMA,
} from "@/lib/free-site-openai-pipeline";
import type { FreeSiteCopy, FreeSiteTemplateInput } from "@/lib/free-site-template";
import {
  ARTWORK_PLACEHOLDER,
  isCompleteGeneratedPageHtml,
} from "@/lib/generated-site-page";
import {
  GENERATE_SITE_STYLE_HEADER,
  resetGenerateSiteStyleRateLimitForTests,
} from "@/lib/server/api-protection";
import type { ArtworkIdentity } from "@/lib/site-style-openai-pipeline";

const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const SHARED_SECRET = "test-free-site-secret";
const ALLOWED_ORIGIN = "https://hoodlums.dev";

const ARTWORK: ArtworkIdentity = {
  dominantColours:
    "Soft peach, warm cream, cocoa brown, dusty rose and a small mint-green accent.",
  memeEnergy:
    "Cute, gentle and optimistic mascot energy with a warm community-first personality.",
  subjectAndIcons:
    "A smiling illustrated mascot with rounded features, soft clouds and a small heart badge.",
  visibleText:
    "The artwork includes the token name in friendly rounded lettering beside the mascot.",
  typographyPersonality:
    "Rounded, approachable display lettering with soft edges and clear readable supporting type.",
  copyVoice:
    "Warm, playful and reassuring, with short friendly lines rather than technical jargon.",
  nonNegotiables:
    "Keep the mascot, warm palette and gentle personality central; avoid hacker, terminal or code-rain styling.",
};

const COPY = Object.fromEntries(
  FREE_SITE_COPY_KEYS.map((key) => [key, `${key} written in the mascot's friendly voice.`]),
) as FreeSiteCopy;
COPY.tokenName = "Cloud Club";
COPY.ticker = "CLOUD";
COPY.contract = "Contract details have not been announced yet.";
COPY.supply = "Supply details have not been announced yet.";
COPY.buyTax = "Buy-tax details have not been announced yet.";
COPY.sellTax = "Sell-tax details have not been announced yet.";
COPY.lpStatus = "Liquidity details have not been announced yet.";
COPY.mintAuth = "Mint-authority details have not been announced yet.";
COPY.ownership = "Ownership details have not been announced yet.";
COPY.xHandle = "The official X handle has not been provided yet.";
COPY.telegram = "The official Telegram has not been provided yet.";

const DESIGN: FreeSiteTemplateInput = {
  theme: {
    palette: {
      background: "#181116",
      surface: "#241a21",
      primary: "#f2a7a0",
      secondary: "#b9d8c2",
      text: "#fff5ef",
    },
    fontPairing: "rounded",
    backgroundEffect: "gradients",
    heroStyle: "centred",
    tokenomicsStyle: "grid",
    roadmapStyle: "cards",
    aboutStyle: "icons",
  },
  copy: COPY,
};

function request(
  body: unknown,
  options: {
    secret?: string | null;
    origin?: string | null;
    ip?: string;
  } = {},
): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-forwarded-for": options.ip || "203.0.113.50",
  });
  const secret = options.secret === undefined ? SHARED_SECRET : options.secret;
  const origin = options.origin === undefined ? ALLOWED_ORIGIN : options.origin;
  if (secret !== null) headers.set(GENERATE_SITE_STYLE_HEADER, secret);
  if (origin !== null) headers.set("Origin", origin);

  return new Request("http://localhost/api/generate-free-site", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function input() {
  return {
    name: "Cloud Club",
    ticker: "CLOUD",
    description:
      "A gentle mascot-led community token about making the internet feel friendlier.",
    imageDataUrl: VALID_IMAGE,
    inspirationUrl: "",
  };
}

function outputText(value: unknown): Response {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function providerMock(design: unknown = DESIGN) {
  return vi
    .fn()
    .mockResolvedValueOnce(outputText(ARTWORK))
    .mockResolvedValueOnce(outputText(design));
}

async function responseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SHARED_SECRET;
  process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ALLOWED_ORIGIN;
  delete process.env.OPENAI_VISION_MODEL;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  resetGenerateSiteStyleRateLimitForTests();
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  delete process.env.OPENAI_VISION_MODEL;
  resetGenerateSiteStyleRateLimitForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/generate-free-site protection", () => {
  it("rejects a missing or wrong shared secret before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const secret of [null, "wrong-secret"]) {
      const response = await POST(request(input(), { secret }));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await responseJson(response)).toEqual({
        error: "Unauthorised website-generation request.",
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a disallowed exact Origin before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request(input(), { origin: "https://attacker.example" }),
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits the eleventh authorised request from one IP in an hour", async () => {
    let providerCall = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      const value = providerCall % 2 === 0 ? ARTWORK : DESIGN;
      providerCall += 1;
      return outputText(value);
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 0; index < 10; index += 1) {
      const response = await POST(request(input(), { ip: "198.51.100.24" }));
      expect(response.status).toBe(200);
    }

    const blocked = await POST(request(input(), { ip: "198.51.100.24" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });
});

describe("POST /api/generate-free-site model validation", () => {
  it("rejects an invalid enum instead of coercing it", async () => {
    const invalid = {
      ...DESIGN,
      theme: { ...DESIGN.theme, fontPairing: "neon" },
    };
    vi.stubGlobal("fetch", providerMock(invalid));

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("theme.fontPairing");
    expect(body.error).toContain("street, blocky, arcade, rounded, cyber, editorial");
  });

  it("rejects an invalid palette value", async () => {
    const invalid = {
      ...DESIGN,
      theme: {
        ...DESIGN.theme,
        palette: { ...DESIGN.theme.palette, primary: "peach" },
      },
    };
    vi.stubGlobal("fetch", providerMock(invalid));

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("theme.palette.primary");
    expect(body.error).toContain("six-digit hexadecimal colour");
  });
});

describe("POST /api/generate-free-site success", () => {
  it("uses the existing high-detail identity call and returns validated, substituted HTML", async () => {
    const fetchMock = providerMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ html: string }>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.html).toContain(VALID_IMAGE);
    expect(body.html).not.toContain(ARTWORK_PLACEHOLDER);

    const validationHtml = body.html.replaceAll(VALID_IMAGE, ARTWORK_PLACEHOLDER);
    expect(isCompleteGeneratedPageHtml(validationHtml)).toBe(true);
    expect(
      isCompleteGeneratedPageHtml(validationHtml, {
        forbidTerminalAesthetic: true,
      }),
    ).toBe(true);

    const artworkRequest = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as {
      max_output_tokens: number;
      input: Array<{
        content: Array<{ type: string; image_url?: string; detail?: string }>;
      }>;
    };
    const designRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as {
      reasoning: { effort: string };
      max_output_tokens: number;
      input: Array<{
        content: Array<{ type: string; text?: string; image_url?: string }>;
      }>;
      text: { format: { strict: boolean; schema: typeof FREE_SITE_DESIGN_SCHEMA } };
    };

    expect(artworkRequest.max_output_tokens).toBe(850);
    expect(artworkRequest.input[1].content[1]).toEqual({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "high",
    });
    expect(designRequest.reasoning).toEqual({ effort: "medium" });
    expect(designRequest.max_output_tokens).toBe(6_000);
    expect(designRequest.text.format.strict).toBe(true);
    expect(designRequest.text.format.schema.properties.copy.required).toHaveLength(55);
    expect(designRequest.input[0].content[0].text).toContain(
      "soft, cute, wholesome or gentle artwork must NOT use terminal tokenomics",
    );
    expect(designRequest.input[0].content[0].text).toContain("4.5:1");
    expect(designRequest.input[1].content).toHaveLength(1);
    expect(designRequest.input[1].content[0]).not.toHaveProperty("image_url");
  });
});
