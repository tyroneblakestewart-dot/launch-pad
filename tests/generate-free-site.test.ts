import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-free-site/route";
import { type FreeSiteDesignSchema } from "@/lib/free-site-openai-pipeline";
import {
  FREE_SITE_SECTION_DEFAULTS,
  freeSiteCopyKeysForSections,
  type FreeSiteCopy,
  type FreeSiteSections,
  type FreeSiteTemplateInput,
} from "@/lib/free-site-template";
import {
  ARTWORK_PLACEHOLDER,
  isCompleteGeneratedPageHtml,
  prepareGeneratedPageForPreview,
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

// Builds a copy object containing exactly the keys the model is allowed to
// return for a given set of section toggles — mirrors the shrunk schema
// (issue #171).
function copyForSections(sections: FreeSiteSections): FreeSiteCopy {
  const copy = Object.fromEntries(
    freeSiteCopyKeysForSections(sections).map((key) => [
      key,
      `${key} written in the mascot's friendly voice.`,
    ]),
  ) as FreeSiteCopy;
  copy.tokenName = "Cloud Club";
  copy.ticker = "CLOUD";
  return copy;
}

const THEME: FreeSiteTemplateInput["theme"] = {
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
};

// The request in input() below sends no `sections`, so the route falls
// back to the studio default (about + tokenomics on, the rest off).
const COPY = copyForSections(FREE_SITE_SECTION_DEFAULTS);

// The raw shape the provider returns over the wire: theme + copy only.
// `sections` is never part of the model's response — the server attaches
// it separately from the request (see parseFreeSiteDesignResponse).
type FreeSiteDesignResponseBody = Pick<FreeSiteTemplateInput, "theme" | "copy">;

const DESIGN: FreeSiteDesignResponseBody = {
  theme: THEME,
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
    supply: "1,000,000,000",
    decimals: 18,
    contractAddress: "0x2222222222222222222222222222222222222222",
    xHandle: "cloudclub",
    telegram: "cloudclub",
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

function incompleteResponse(reason = "max_output_tokens"): Response {
  return new Response(
    JSON.stringify({ status: "incomplete", incomplete_details: { reason }, output: [] }),
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
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
  it("uses the hardened page-pipeline identity call and returns placeholder-bearing HTML for the client to substitute", async () => {
    const fetchMock = providerMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ html: string }>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.html).toContain(ARTWORK_PLACEHOLDER);
    expect(body.html).not.toContain(VALID_IMAGE);

    expect(isCompleteGeneratedPageHtml(body.html)).toBe(true);
    expect(
      isCompleteGeneratedPageHtml(body.html, {
        forbidTerminalAesthetic: true,
      }),
    ).toBe(true);

    const prepared = prepareGeneratedPageForPreview(body.html, VALID_IMAGE);
    expect(prepared).toContain(VALID_IMAGE);
    expect(prepared).not.toContain(ARTWORK_PLACEHOLDER);

    const artworkRequest = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as {
      reasoning: { effort: string };
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
      text: { format: { strict: boolean; schema: FreeSiteDesignSchema } };
    };

    expect(artworkRequest.max_output_tokens).toBe(1_500);
    expect(artworkRequest.reasoning).toEqual({ effort: "minimal" });
    expect(artworkRequest.input[1].content[1]).toEqual({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "high",
    });
    expect(designRequest.reasoning).toEqual({ effort: "minimal" });
    expect(designRequest.max_output_tokens).toBe(6_000);
    expect(designRequest.text.format.strict).toBe(true);
    // input() sends no `sections`, so the route falls back to the studio
    // default (about + tokenomics on, the rest off) and the schema only
    // asks the model for those sections' copy plus hero/community.
    expect(designRequest.text.format.schema.properties.copy.required).toHaveLength(
      freeSiteCopyKeysForSections(FREE_SITE_SECTION_DEFAULTS).length,
    );
    expect(designRequest.text.format.schema.properties.copy.required).not.toContain("roadmapTitle");
    expect(designRequest.text.format.schema.properties.copy.required).not.toContain("faqTitle");
    expect(designRequest.input[0].content[0].text).toContain(
      "Only write copy for these enabled sections: about, tokenomics.",
    );
    expect(designRequest.input[0].content[0].text).toContain(
      "Do not mention or imply the existence of these disabled sections: roadmap, howToBuy, faq.",
    );
    expect(designRequest.input[0].content[0].text).toContain(
      "soft, cute, wholesome or gentle artwork must NOT use terminal tokenomics",
    );
    expect(designRequest.input[0].content[0].text).toContain("4.5:1");
    expect(designRequest.input[1].content).toHaveLength(1);
    expect(designRequest.input[1].content[0]).not.toHaveProperty("image_url");
  });

  it("retries once and succeeds when the first artwork response is incomplete and the second is valid", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse())
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(outputText(DESIGN));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ html: string }>(response);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(body.html).toContain(ARTWORK_PLACEHOLDER);
    expect(console.warn).toHaveBeenCalledWith(
      "AI artwork identity response was incomplete; retrying once",
      expect.stringContaining("max_output_tokens"),
    );
  });
});

describe("POST /api/generate-free-site facts", () => {
  it("renders supply, decimals, contract and socials from the request body rather than the model", async () => {
    vi.stubGlobal("fetch", providerMock());

    const response = await POST(request(input()));
    const body = await responseJson<{ html: string }>(response);

    expect(response.status).toBe(200);
    expect(body.html).toContain("1,000,000,000");
    expect(body.html).toContain(">18<");
    expect(body.html).toContain("0x2222222222222222222222222222222222222222");
    expect(body.html).toContain('href="https://x.com/cloudclub"');
    expect(body.html).toContain('href="https://t.me/cloudclub"');
    expect(body.html.toLowerCase()).not.toContain("not announced yet");
  });

  it("renders the fixed contract guarantees regardless of what the request supplies", async () => {
    vi.stubGlobal("fetch", providerMock());

    const response = await POST(request(input()));
    const body = await responseJson<{ html: string }>(response);

    expect(body.html).toContain(">0%<");
    expect(body.html).toContain(">None<");
    expect(body.html).toContain(">No owner<");
  });

  it("omits the community section, contract bar and Buy CTA when socials and contract are blank", async () => {
    vi.stubGlobal("fetch", providerMock());

    const blank = {
      ...input(),
      contractAddress: "",
      xHandle: "",
      telegram: "",
    };
    const response = await POST(request(blank));
    const body = await responseJson<{ html: string }>(response);

    expect(response.status).toBe(200);
    expect(body.html).not.toContain("CA:");
    expect(body.html).not.toContain('href="#community"');
    expect(isCompleteGeneratedPageHtml(body.html)).toBe(true);
  });
});

describe("POST /api/generate-free-site artwork failures", () => {
  it("returns an invalid-identity error after two failed artwork parses without a third attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse("max_output_tokens"))
      .mockResolvedValueOnce(outputText({ dominantColours: "too short" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe("The AI returned an invalid artwork identity.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a provider-level artwork failure and reports the http status", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "The AI artwork-analysis service could not complete the request (http 500).",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a timed-out artwork call distinctly from a general network error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "The AI artwork-analysis service could not complete the request (timeout).",
    );
  });

  it("reports a general artwork network error as network, not timeout", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "The AI artwork-analysis service could not complete the request (network).",
    );
  });
});

describe("POST /api/generate-free-site design failures", () => {
  it("reports the http status when the design request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "The AI free-site design service could not complete the request (http 429).",
    );
  });

  it("reports a timed-out design call as timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockRejectedValueOnce(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "The AI free-site design service could not complete the request (timeout).",
    );
  });
});

describe("POST /api/generate-free-site sections", () => {
  const ALL_SECTIONS: FreeSiteSections = {
    about: true,
    tokenomics: true,
    roadmap: true,
    howToBuy: true,
    faq: true,
  };
  const NONE_SECTIONS: FreeSiteSections = {
    about: false,
    tokenomics: false,
    roadmap: false,
    howToBuy: false,
    faq: false,
  };

  it("shrinks the copy schema to hero + community only when every optional section is disabled", async () => {
    const design: FreeSiteDesignResponseBody = { theme: THEME, copy: copyForSections(NONE_SECTIONS) };
    const fetchMock = providerMock(design);
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ ...input(), sections: NONE_SECTIONS }));
    expect(response.status).toBe(200);

    const designRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { text: { format: { schema: FreeSiteDesignSchema } } };
    expect(designRequest.text.format.schema.properties.copy.required).toHaveLength(5);
    expect(designRequest.text.format.schema.properties.copy.required).toEqual(
      expect.arrayContaining(["tokenName", "ticker", "kicker", "tagline", "communityTitle"]),
    );
  });

  it("grows the copy schema back to all 46 fields when every optional section is enabled", async () => {
    const design: FreeSiteDesignResponseBody = { theme: THEME, copy: copyForSections(ALL_SECTIONS) };
    const fetchMock = providerMock(design);
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ ...input(), sections: ALL_SECTIONS }));
    expect(response.status).toBe(200);

    const designRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { text: { format: { schema: FreeSiteDesignSchema } } };
    expect(designRequest.text.format.schema.properties.copy.required).toHaveLength(46);
  });

  it("renders only the requested sections end to end", async () => {
    const sections: FreeSiteSections = {
      about: true,
      tokenomics: false,
      roadmap: false,
      howToBuy: false,
      faq: false,
    };
    const design: FreeSiteDesignResponseBody = { theme: THEME, copy: copyForSections(sections) };
    vi.stubGlobal("fetch", providerMock(design));

    const response = await POST(request({ ...input(), sections }));
    const body = await responseJson<{ html: string }>(response);

    expect(response.status).toBe(200);
    expect(isCompleteGeneratedPageHtml(body.html)).toBe(true);
    expect(body.html).toContain('<section id="roadmap" aria-hidden="true" style="display:none"></section>');
    expect(body.html).not.toContain('href="#roadmap"');
  });

  it("falls back to the studio default (about + tokenomics) when sections is omitted", async () => {
    const fetchMock = providerMock();
    vi.stubGlobal("fetch", fetchMock);

    // input() sends no `sections` field at all.
    const response = await POST(request(input()));
    expect(response.status).toBe(200);

    const designRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { text: { format: { schema: FreeSiteDesignSchema } } };
    expect(designRequest.text.format.schema.properties.copy.required).toHaveLength(
      freeSiteCopyKeysForSections(FREE_SITE_SECTION_DEFAULTS).length,
    );
  });

  it("falls back to the default for a malformed sections value instead of rejecting the request", async () => {
    const fetchMock = providerMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ ...input(), sections: { about: "yes", roadmap: 1 } }));
    expect(response.status).toBe(200);

    const designRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { text: { format: { schema: FreeSiteDesignSchema } } };
    expect(designRequest.text.format.schema.properties.copy.required).toHaveLength(
      freeSiteCopyKeysForSections(FREE_SITE_SECTION_DEFAULTS).length,
    );
  });

  it("rejects a model response that writes copy for a section that was not requested", async () => {
    // roadmapTitle was not asked for (roadmap disabled by default here), but
    // the model wrote it anyway.
    const overreaching = {
      theme: THEME,
      copy: { ...copyForSections(FREE_SITE_SECTION_DEFAULTS), roadmapTitle: "Uninvited roadmap" },
    };
    vi.stubGlobal("fetch", providerMock(overreaching));

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("copy fields do not match the required schema");
  });

  it("rejects a model response missing copy for a requested section", async () => {
    const incomplete = copyForSections(FREE_SITE_SECTION_DEFAULTS);
    delete incomplete.tokenomicsTitle;
    vi.stubGlobal("fetch", providerMock({ theme: THEME, copy: incomplete }));

    const response = await POST(request(input()));
    const body = await responseJson<{ error: string }>(response);

    expect(response.status).toBe(502);
    expect(body.error).toContain("copy fields do not match the required schema");
  });
});
