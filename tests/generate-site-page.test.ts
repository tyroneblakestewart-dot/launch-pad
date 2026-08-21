import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST, maxDuration } from "@/app/api/generate-site-page/route";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import { NO_URL_PRESENTATION_BRIEF } from "@/lib/site-page-openai-pipeline";
import {
  getFusionBriefIds,
  type ArtworkIdentity,
} from "@/lib/site-style-openai-pipeline";
import { readNdjsonEvents, sseEventChunk, sseResponse } from "./generate-site-page-test-helpers";

const ROOT = process.cwd();
const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const URL = "https://example.com/inspiration";
const ARTWORK: ArtworkIdentity = {
  dominantColours: "Powder blue, charcoal black, steel grey, white and restrained transit red accents.",
  memeEnergy: "Curious London journey energy with a playful child-led sense of movement and discovery.",
  subjectAndIcons: "A child studying a Tube map while standing on a scooter, with route lines, station glass and transport details.",
  visibleText: "Tube map and small London transport labels are visible but should not become the project name.",
  typographyPersonality: "Friendly rounded transport signage with clear bold headings rather than cyber or military display type.",
  copyVoice: "Warm, adventurous, direct and optimistic, written like a city journey shared with a community.",
  nonNegotiables: "Keep the child, scooter and route-map story central; do not convert the image into hacker, heist or terminal imagery.",
};
const INSPIRATION =
  "Use a spacious retail marketplace homepage structure with a utility header, prominent primary navigation, search-like product discovery, large seasonal campaign cards, repeated three- and four-card grids, category browsing and clear promotional calls to action. Keep the rhythm bright, friendly and easy to scan without copying the source brand.";

function html(extra = "") {
  const copy = "Original campaign content shaped by the uploaded journey artwork. ".repeat(105);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journey token</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f6fbfd;color:#15232d}header,section{padding:48px 6vw}.cards{display:grid;grid-template-columns:1fr;gap:18px}@media(min-width:700px){.cards{grid-template-columns:repeat(3,1fr)}}</style></head><body><header><nav>Discover About Roadmap Community</nav><form role="search"><input type="search" aria-label="Discover routes"></form></header><section id="hero"><h1>The city is the adventure</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"><button>Start exploring</button></section><section id="about"><h2>About the journey</h2><p>${copy}</p></section><section id="tokenomics"><h2>Token details</h2><div class="cards category-grid"><article>Supply</article><article>Community</article><article>Launch</article></div></section><section id="roadmap"><h2>Next stops</h2><div class="cards campaign-grid"><article>Map it</article><article>Ride it</article><article>Share it</article></div></section><section id="how-to-buy"><h2>How to join</h2><ol><li>Connect</li><li>Choose</li><li>Swap</li><li>Ride</li></ol></section><section id="community"><h2>Travel together</h2><button>Join community</button></section>${extra}<script>document.querySelector('img').onclick=function(){document.body.classList.toggle('celebrate')}</script></body></html>`;
}

function request(body: unknown) {
  return new Request("http://localhost/api/generate-site-page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function outputText(value: unknown) {
  return new Response(
    JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function incompleteResponse(reason = "max_output_tokens") {
  return new Response(
    JSON.stringify({
      status: "incomplete",
      incomplete_details: { reason },
      output: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function inspirationResponse() {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: { sources: [{ type: "url", url: URL }] },
        },
        { type: "message", content: [{ type: "output_text", text: INSPIRATION }] },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** A streamed provider response whose single response.completed event carries `value`. */
function streamedPage(value: unknown) {
  return sseResponse([
    sseEventChunk({ type: "response.output_text.delta", delta: "" }),
    sseEventChunk({
      type: "response.completed",
      response: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] },
    }),
  ]);
}

describe("POST /api/generate-site-page", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses a route timeout large enough for the whole streamed generation", () => {
    expect(maxDuration).toBe(120);
  });

  it("returns the streamed response as no-store application/x-ndjson", async () => {
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(streamedPage({ html: html(), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: "",
      }),
    );

    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await readNdjsonEvents(response);
  });

  it("analyses artwork and URL separately, streams progress, then streams a complete original page", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(streamedPage({ html: html(), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: URL,
      }),
    );
    const events = await readNdjsonEvents(response);

    expect(events.slice(0, 4)).toEqual([
      { type: "progress", stage: "analysing-artwork" },
      { type: "progress", stage: "preparing-design" },
      { type: "progress", stage: "building-page" },
      { type: "progress", stage: "checking-safety" },
    ]);
    expect(events.at(-1)).toEqual({ type: "complete", html: html(), source: "openai", inspirationUsed: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const artworkRequest = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as {
      max_output_tokens: number;
      reasoning: { effort: string };
      text: { format: { schema: unknown } };
    };
    const finalRequest = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)) as {
      max_output_tokens: number;
      reasoning: { effort: string };
      stream: boolean;
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string; detail?: string }> }>;
      text: { format: { schema: unknown } };
    };
    expect(artworkRequest.max_output_tokens).toBe(1_500);
    expect(artworkRequest.reasoning).toEqual({ effort: "minimal" });
    expect(finalRequest.stream).toBe(true);
    expect(finalRequest.max_output_tokens).toBe(20_000);
    expect(finalRequest.reasoning).toEqual({ effort: "minimal" });
    expect(finalRequest.input[0].content[0].text).toContain("Artwork owns the page identity");
    expect(finalRequest.input[0].content[0].text).toContain("bright, spacious discovery experience");
    expect(finalRequest.input[0].content[0].text).toContain("concise enough to finish");
    // Desktop + mobile responsiveness, smooth scroll and layout-quality
    // requirements are non-negotiable in the developer prompt (issue #303).
    expect(finalRequest.input[0].content[0].text).toContain(
      "RESPONSIVE & LAYOUT QUALITY REQUIREMENTS (NON-NEGOTIABLE)",
    );
    expect(finalRequest.input[0].content[0].text).toContain('name="viewport" content="width=device-width, initial-scale=1"');
    expect(finalRequest.input[0].content[0].text).toContain("390px, 768px and 1280px+");
    expect(finalRequest.input[0].content[0].text).toContain("centre all content inside a max-width container");
    expect(finalRequest.input[0].content[0].text).toContain("scroll-behavior: smooth;");
    expect(finalRequest.input[0].content[0].text).toContain("no element may be wider than the viewport");
    expect(finalRequest.input[1].content[0].text).toContain(INSPIRATION);
    expect(finalRequest.input[1].content[1]).toMatchObject({
      type: "input_image",
      image_url: VALID_IMAGE,
      detail: "low",
    });
    expect(JSON.stringify(artworkRequest.text.format.schema)).not.toMatch(/minLength|maxLength|pattern/);
    expect(JSON.stringify(finalRequest.text.format.schema)).not.toMatch(/minLength|maxLength|pattern/);
    expect(JSON.stringify(finalRequest)).not.toContain("initiate_heist");
  });

  it("streams a truthful network error without automatically spending on another full-page attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockRejectedValueOnce(new Error("The operation was aborted due to timeout"));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: "",
      }),
    );
    const events = await readNdjsonEvents(response);
    const errorEvent = events.at(-1);

    expect(errorEvent?.type).toBe("error");
    expect((errorEvent as { error: string }).error).toContain("connection to the AI was interrupted");
    expect((errorEvent as { error: string }).error).toContain("does not need to be replaced");
    expect((errorEvent as { providerError: unknown }).providerError).toMatchObject({
      stage: "full-page-generation",
      provider: "openai",
      kind: "network",
      status: null,
    });
    expect((errorEvent as { providerError: { detail: string } }).providerError.detail).toContain("aborted due to timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("streams a distinct, truthful error when the generation stream is incomplete, and never retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(
        sseResponse([
          sseEventChunk({
            type: "response.incomplete",
            response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
          }),
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: "",
      }),
    );
    const events = await readNdjsonEvents(response);

    expect(events.filter((event) => event.type === "complete")).toEqual([]);
    const errorEvent = events.at(-1) as { type: string; error: string; providerError: { kind: string } };
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.error).toContain("stopped before finishing");
    expect(errorEvent.providerError).toMatchObject({ kind: "incomplete" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries one incomplete artwork response and continues when the retry is valid", async () => {
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse())
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(streamedPage({ html: html(), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: "",
      }),
    );
    const events = await readNdjsonEvents(response);

    expect(events.at(-1)).toMatchObject({ type: "complete", source: "openai", inspirationUsed: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      "AI artwork identity response was incomplete; retrying once",
      expect.stringContaining("max_output_tokens"),
    );
  });

  it("streams a truthful error after two incomplete artwork analyses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse("max_output_tokens"))
      .mockResolvedValueOnce(outputText({ dominantColours: "too short" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: "",
      }),
    );
    const events = await readNdjsonEvents(response);
    const errorEvent = events.at(-1) as {
      type: string;
      error: string;
      providerError: { stage: string; kind: string; status: number | null; detail: string };
    };

    expect(errorEvent.type).toBe("error");
    expect(errorEvent.error).toContain("incomplete artwork analysis twice");
    expect(errorEvent.error).toContain("artwork has not been rejected");
    expect(errorEvent.providerError).toMatchObject({
      stage: "page-artwork-analysis-parse",
      kind: "invalid",
      status: null,
    });
    expect(errorEvent.providerError.detail).toContain("max_output_tokens");
    expect(errorEvent.providerError.detail).toContain("attempt 2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects, before completion, a retail-inspired result that falls back to terminal and heist styling", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(
        streamedPage({ html: html("<p>root@token:~$ tokenomics.sh join the heist</p>"), ...ids }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    const events = await readNdjsonEvents(response);

    expect(events.some((event) => event.type === "progress" && event.stage === "checking-safety")).toBe(true);
    expect(events.some((event) => event.type === "complete")).toBe(false);
    const errorEvent = events.at(-1) as { type: string; error: string };
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.error).toContain("legacy terminal fallback");
  });

  it("rejects a full page that echoes the wrong collaboration evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(
        streamedPage({
          html: html(),
          artworkBriefId: "art-deadbeef",
          inspirationBriefId: "url-deadbeef",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    const events = await readNdjsonEvents(response);
    const errorEvent = events.at(-1) as { type: string; error: string };
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.error).toContain("incomplete, unsafe");
  });

  describe("content filter (issue #392)", () => {
    it("rejects a slur in the description before calling any provider", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(
        request({
          name: "Journey",
          ticker: "RIDE",
          description: "A nigger coin for the community, buy now.",
          imageDataUrl: VALID_IMAGE,
          inspirationUrl: "",
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("description") });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects generated HTML that fails the content safety filter instead of streaming it to the client", async () => {
      const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
      const poisonedHtml = html().replace(
        "Original campaign content shaped by the uploaded journey artwork.",
        "Original campaign content about kike coins shaped by the uploaded journey artwork.",
      );
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(outputText(ARTWORK))
        .mockResolvedValueOnce(streamedPage({ html: poisonedHtml, ...ids }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(
        request({
          name: "Journey",
          ticker: "RIDE",
          description: "A community token inspired by finding your route through London.",
          imageDataUrl: VALID_IMAGE,
          inspirationUrl: "",
        }),
      );
      const events = await readNdjsonEvents(response);

      expect(events.some((event) => event.type === "complete")).toBe(false);
      const errorEvent = events.at(-1) as { type: string; error: string };
      expect(errorEvent.type).toBe("error");
      expect(errorEvent.error).toContain("content safety filter");
    });

    it("passes crude but allowed content", async () => {
      const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(outputText(ARTWORK))
        .mockResolvedValueOnce(streamedPage({ html: html(), ...ids }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(
        request({
          name: "Journey",
          ticker: "RIDE",
          description: "This degenerate ape coin is for adults only, fuck the bear market.",
          imageDataUrl: VALID_IMAGE,
          inspirationUrl: "",
        }),
      );
      const events = await readNdjsonEvents(response);
      expect(events.some((event) => event.type === "complete")).toBe(true);
    });
  });

  // Issue #323 part 1: a page rejected only for the responsive-layout
  // baseline gets exactly one automatic retry with corrective feedback,
  // instead of failing the whole request over a fixable layout mistake.
  function squishedHtml() {
    return html().replace(
      ".cards{display:grid;grid-template-columns:1fr;gap:18px}@media(min-width:700px){.cards{grid-template-columns:repeat(3,1fr)}}",
      ".cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}",
    );
  }

  describe("one automatic retry on a layout-only rejection", () => {
    it("retries once with corrective feedback and succeeds on the second attempt", async () => {
      const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(outputText(ARTWORK))
        .mockResolvedValueOnce(streamedPage({ html: squishedHtml(), ...ids }))
        .mockResolvedValueOnce(streamedPage({ html: html(), ...ids }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(
        request({
          name: "Journey",
          ticker: "RIDE",
          description: "A community token inspired by finding your route through London.",
          imageDataUrl: VALID_IMAGE,
          inspirationUrl: "",
        }),
      );
      const events = await readNdjsonEvents(response);
      const completeEvent = events.at(-1) as { type: string; html: string };

      expect(fetchMock).toHaveBeenCalledTimes(3);
      const retryBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string) as {
        input: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
      };
      const developerText = retryBody.input.find((item) => item.role === "developer")?.content[0]?.text || "";
      expect(developerText).toContain("CORRECTIVE FEEDBACK FROM THE REJECTED PREVIOUS ATTEMPT");
      expect(developerText).toContain("responsive-layout check");

      expect(completeEvent.type).toBe("complete");
      expect(completeEvent.html).toBe(html());
    });

    it("does not retry, and fails immediately, when the rejection reason is not layout", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(outputText(ARTWORK))
        .mockResolvedValueOnce(
          streamedPage({ html: html().replace('id="community"', 'id="missing"'), ...getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF) }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(
        request({
          name: "Journey",
          ticker: "RIDE",
          description: "A community token inspired by finding your route through London.",
          imageDataUrl: VALID_IMAGE,
          inspirationUrl: "",
        }),
      );
      const events = await readNdjsonEvents(response);
      const errorEvent = events.at(-1) as { type: string };

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(errorEvent.type).toBe("error");
    });

    it("surfaces the second attempt's own failure if the retry itself does not succeed", async () => {
      const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(outputText(ARTWORK))
        .mockResolvedValueOnce(streamedPage({ html: squishedHtml(), ...ids }))
        .mockResolvedValueOnce(streamedPage({ html: squishedHtml(), ...ids }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await POST(
        request({
          name: "Journey",
          ticker: "RIDE",
          description: "A community token inspired by finding your route through London.",
          imageDataUrl: VALID_IMAGE,
          inspirationUrl: "",
        }),
      );
      const events = await readNdjsonEvents(response);
      const errorEvent = events.at(-1) as { type: string; error: string };

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(errorEvent.type).toBe("error");
      expect(errorEvent.error).toContain("incomplete, unsafe");
    });
  });

  it("keeps uploaded artwork mandatory", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ inspirationUrl: URL }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("full website frontend wiring", () => {
  it("uses the full page endpoint and never presents the fixed fallback as a finished result", async () => {
    const page = await readFile(path.join(ROOT, "app", "(app)", "page.tsx"), "utf8");
    const generator = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );
    const bridge = await readFile(
      path.join(ROOT, "components", "generate-site-style-auth-bridge.tsx"),
      "utf8",
    );

    expect(page).toContain("FullWebsiteGenerator");
    expect(page).not.toContain("ArtworkSiteGenerator");
    expect(generator).toContain('fetch("/api/generate-site-page"');
    expect(generator).toContain('frame.setAttribute("sandbox", "allow-scripts")');
    expect(generator).toContain("frame.srcdoc = prepared");
    expect(generator).toContain("hoodlums-generated-page-height");
    expect(generator).toContain("full-page-generating");
    expect(generator).toContain("full-page-failed");
    expect(generator).toContain("The terminal-style base preview has not been accepted");
    expect(generator).toContain("previewAvailable: false");
    expect(bridge).toContain('"/api/generate-site-page"');
  });

  it("streams NDJSON progress, aborts a previous request, and keeps only one iframe", async () => {
    const generator = await readFile(
      path.join(ROOT, "components", "full-website-generator.tsx"),
      "utf8",
    );

    // NDJSON is parsed incrementally via the shared protocol helpers, not response.json().
    expect(generator).toContain("splitNdjsonLines");
    expect(generator).toContain("parseGenerateSitePageStreamLine");
    expect(generator).toContain("options.onProgress?.(event.stage)");

    // A previous in-flight request is aborted before a new one starts, and on unmount.
    expect(generator).toContain("activeController?.abort();");
    const abortCount = (generator.match(/activeController\?\.abort\(\);/g) || []).length;
    expect(abortCount).toBeGreaterThanOrEqual(2);

    // Only one call site ever creates the preview iframe.
    const iframeCreationCount = (generator.match(/document\.createElement\("iframe"\)/g) || []).length;
    expect(iframeCreationCount).toBe(1);

    // The previous frame's srcdoc is cleared before it is removed/replaced (memory safety on iOS Safari).
    expect(generator).toContain('frame.srcdoc = "";');
    expect(generator.indexOf('frame.srcdoc = "";')).toBeLessThan(generator.indexOf("frame.remove();"));

    // HTML is only ever assigned to the DOM from renderGeneratedWebsite, which only runs after
    // requestGeneratedWebsite has resolved (i.e. after the "complete" event, past validation) -
    // never from inside the onProgress callback used for partial/progress frames.
    const onProgressStart = generator.indexOf("onProgress: (stage) => {");
    const onProgressEnd = generator.indexOf("},", onProgressStart);
    const onProgressBody = generator.slice(onProgressStart, onProgressEnd);
    expect(onProgressBody).not.toContain("renderGeneratedWebsite");
    expect(onProgressBody).not.toContain("srcdoc");
  });
});
