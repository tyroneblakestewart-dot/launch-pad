import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_STREAMED_GENERATED_TEXT_LENGTH,
  POST,
  maxDuration,
} from "@/app/api/generate-site-page/route";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import { NO_URL_PRESENTATION_BRIEF } from "@/lib/site-page-openai-pipeline";
import {
  getFusionBriefIds,
  type ArtworkIdentity,
} from "@/lib/site-style-openai-pipeline";

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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journey token</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f6fbfd;color:#15232d}header,section{padding:48px 6vw}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}@media(max-width:700px){.cards{grid-template-columns:1fr}}</style></head><body><header><nav>Discover About Roadmap Community</nav><form role="search"><input type="search" aria-label="Discover routes"></form></header><section id="hero"><h1>The city is the adventure</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"><button>Start exploring</button></section><section id="about"><h2>About the journey</h2><p>${copy}</p></section><section id="tokenomics"><h2>Token details</h2><div class="cards category-grid"><article>Supply</article><article>Community</article><article>Launch</article></div></section><section id="roadmap"><h2>Next stops</h2><div class="cards campaign-grid"><article>Map it</article><article>Ride it</article><article>Share it</article></div></section><section id="how-to-buy"><h2>How to join</h2><ol><li>Connect</li><li>Choose</li><li>Swap</li><li>Ride</li></ol></section><section id="community"><h2>Travel together</h2><button>Join community</button></section>${extra}<script>document.querySelector('img').onclick=function(){document.body.classList.toggle('celebrate')}</script></body></html>`;
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

function sseEvent(json: unknown): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function completedStream(payload: unknown): Response {
  return sseResponse([
    sseEvent({ type: "response.output_text.delta", delta: "partial-chunk-should-not-leak-1" }),
    sseEvent({ type: "response.output_text.delta", delta: "partial-chunk-should-not-leak-2" }),
    sseEvent({
      type: "response.completed",
      response: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] }] },
    }),
  ]);
}

async function readNdjson(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

  it("uses a route ceiling with no separate application-level stream timeout", () => {
    expect(maxDuration).toBe(120);
    expect(MAX_STREAMED_GENERATED_TEXT_LENGTH).toBe(220_000);
  });

  it("streams NDJSON progress then a complete event for a full success", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(completedStream({ html: html(), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const req = request({
      name: "Journey",
      ticker: "RIDE",
      description: "A community token inspired by finding your route through London.",
      imageDataUrl: VALID_IMAGE,
      inspirationUrl: URL,
    });
    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const events = await readNdjson(response);
    expect(events).toEqual([
      { type: "progress", stage: "analysing-artwork", message: expect.any(String) },
      { type: "progress", stage: "preparing-design", message: expect.any(String) },
      { type: "progress", stage: "building-page", message: expect.any(String), receivedCharacters: 0 },
      { type: "progress", stage: "checking-safety", message: expect.any(String) },
      { type: "complete", html: html(), source: "openai", inspirationUsed: true },
    ]);
    expect(JSON.stringify(events)).not.toContain("partial-chunk-should-not-leak");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const finalInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect(JSON.parse(String(finalInit.body)).stream).toBe(true);
    expect(finalInit.signal).toBe(req.signal);
  });

  it("parses the completed SSE event even when split across arbitrary chunk boundaries", async () => {
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    const full = sseEvent({
      type: "response.completed",
      response: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ html: html(), ...ids }) }] }] },
    });

    for (let cut = 1; cut < full.length; cut += 23) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(outputText(ARTWORK))
        .mockResolvedValueOnce(sseResponse([full.slice(0, cut), full.slice(cut)]));
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
      const events = await readNdjson(response);
      expect(events.at(-1)).toEqual({ type: "complete", html: html(), source: "openai", inspirationUsed: false });
      vi.unstubAllGlobals();
    }
  });

  it("uses text length from response.output_text.done only when no deltas were received, and reports a final count", async () => {
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    const finalText = "x".repeat(1_234);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(
        sseResponse([
          sseEvent({ type: "response.output_text.done", text: finalText }),
          sseEvent({
            type: "response.completed",
            response: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ html: html(), ...ids }) }] }] },
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
    const events = await readNdjson(response);
    const buildingPageEvents = events.filter(
      (event) => event.type === "progress" && event.stage === "building-page",
    );
    expect(buildingPageEvents.at(-1)).toMatchObject({ receivedCharacters: 1_234 });
  });

  it("does not double-count deltas when response.output_text.done also arrives", async () => {
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(
        sseResponse([
          sseEvent({ type: "response.output_text.delta", delta: "a".repeat(500) }),
          sseEvent({ type: "response.output_text.done", text: "should-be-ignored-when-deltas-seen" }),
          sseEvent({
            type: "response.completed",
            response: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ html: html(), ...ids }) }] }] },
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
    const events = await readNdjson(response);
    const buildingPageEvents = events.filter(
      (event) => event.type === "progress" && event.stage === "building-page",
    );
    expect(buildingPageEvents.at(-1)).toMatchObject({ receivedCharacters: 500 });
  });

  it("fails cleanly with no retry when the streamed response exceeds the safe size cap", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(
        sseResponse([
          sseEvent({ type: "response.output_text.delta", delta: "a".repeat(MAX_STREAMED_GENERATED_TEXT_LENGTH - 100) }),
          sseEvent({ type: "response.output_text.delta", delta: "b".repeat(200) }),
          sseEvent({ type: "response.completed", response: { output: [] } }),
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
    const events = await readNdjson(response);
    const buildingPageProgress = events.filter(
      (event) => event.type === "progress" && event.stage === "building-page",
    );
    expect(buildingPageProgress.some((event) => (event.receivedCharacters as number) >= 2_000)).toBe(true);

    const errorEvent = events.at(-1) as { type: string; providerError: Record<string, unknown> };
    expect(errorEvent.type).toBe("error");
    expect(String(errorEvent.providerError.detail)).toContain("safe size limit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a sanitized streamed provider failure from response.failed with no retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(
        sseResponse([
          sseEvent({
            type: "response.failed",
            response: { error: { message: "Bearer secret-provider-token invalid request" } },
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
    const events = await readNdjson(response);
    const errorEvent = events.at(-1) as { type: string; error: string; providerError: Record<string, unknown> };
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.providerError).toMatchObject({ stage: "full-page-generation", provider: "openai", kind: "invalid" });
    expect(JSON.stringify(events)).not.toContain("secret-provider-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a streamed response.incomplete failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(
        sseResponse([
          sseEvent({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }),
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
    const events = await readNdjson(response);
    const errorEvent = events.at(-1) as { providerError: Record<string, unknown> };
    expect(String(errorEvent.providerError.detail)).toContain("incomplete");
    expect(String(errorEvent.providerError.detail)).toContain("max_output_tokens");
  });

  it("reports a sanitized generic top-level error SSE event distinctly from response.failed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(
        sseResponse([sseEvent({ type: "error", message: "Bearer secret-provider-token rate limited" })]),
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
    const events = await readNdjson(response);
    const errorEvent = events.at(-1) as { providerError: Record<string, unknown> };
    expect(String(errorEvent.providerError.detail)).toContain("rate limited");
    expect(JSON.stringify(events)).not.toContain("secret-provider-token");
  });

  it("reports a network interruption mid-stream without retrying", async () => {
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
    const events = await readNdjson(response);
    const errorEvent = events.at(-1) as { error: string; providerError: Record<string, unknown> };
    expect(errorEvent.error).toContain("interrupted");
    expect(errorEvent.providerError).toMatchObject({ stage: "full-page-generation", provider: "openai", kind: "network" });
    expect(String(errorEvent.providerError.detail)).toContain("aborted due to timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries one incomplete artwork response and continues into the stream when the retry is valid", async () => {
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse())
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(completedStream({ html: html(), ...ids }));
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

    const events = await readNdjson(response);
    expect(events.at(-1)).toMatchObject({ type: "complete", source: "openai", inspirationUsed: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      "AI artwork identity response was incomplete; retrying once",
      expect.stringContaining("max_output_tokens"),
    );
  });

  it("reports a truthful error after two incomplete artwork analyses with no full-page call", async () => {
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
    const events = await readNdjson(response);
    const errorEvent = events.at(-1) as { error: string; providerError: Record<string, unknown> };
    expect(errorEvent.error).toContain("incomplete artwork analysis twice");
    expect(errorEvent.error).toContain("artwork has not been rejected");
    expect(errorEvent.providerError).toMatchObject({ stage: "page-artwork-analysis-parse", kind: "invalid", status: null });
    expect(String(errorEvent.providerError.detail)).toContain("max_output_tokens");
    expect(String(errorEvent.providerError.detail)).toContain("attempt 2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a retail-inspired result that falls back to terminal and heist styling", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(completedStream({ html: html("<p>root@token:~$ tokenomics.sh join the heist</p>"), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    const events = await readNdjson(response);
    expect(String((events.at(-1) as { error: string }).error)).toContain("legacy terminal fallback");
  });

  it("rejects a full page that echoes the wrong collaboration evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(
        completedStream({
          html: html(),
          artworkBriefId: "art-deadbeef",
          inspirationBriefId: "url-deadbeef",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    const events = await readNdjson(response);
    expect(String((events.at(-1) as { error: string }).error)).toContain("incomplete, unsafe");
  });

  it("keeps uploaded artwork mandatory as a normal pre-stream JSON response", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ inspirationUrl: URL }));
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("full website frontend wiring", () => {
  it("uses the full page endpoint and never presents the fixed fallback as a finished result", async () => {
    const page = await readFile(path.join(ROOT, "app", "page.tsx"), "utf8");
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
    expect(generator).toContain('Accept: "application/x-ndjson"');
    expect(generator).toContain('frame.setAttribute("sandbox", "allow-scripts")');
    expect(generator).toContain("frame.srcdoc = prepared");
    expect(generator).toContain("hoodlums-generated-page-height");
    expect(generator).toContain("full-page-generating");
    expect(generator).toContain("full-page-failed");
    expect(generator).toContain("The terminal-style base preview has not been accepted");
    expect(generator).toContain("previewAvailable: false");
    expect(bridge).toContain('"/api/generate-site-page"');
  });
});
