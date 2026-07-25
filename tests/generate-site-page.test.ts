import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_STREAMED_GENERATED_TEXT_LENGTH, POST, maxDuration } from "@/app/api/generate-site-page/route";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import { NO_URL_PRESENTATION_BRIEF } from "@/lib/site-page-openai-pipeline";
import {
  getFusionBriefIds,
  type ArtworkIdentity,
} from "@/lib/site-style-openai-pipeline";
import {
  generatedPagePayload,
  outputTextDeltaEvent,
  responseCompletedEvent,
  responseFailedEvent,
  responseIncompleteEvent,
  sseChunkedStreamResponse,
  sseEventText,
} from "./sse-test-support";

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

function fullPageStream(pageValue: unknown, deltaChunks: string[] = []) {
  const deltaEvents = deltaChunks.map((chunk) => sseEventText(outputTextDeltaEvent(chunk)));
  const completed = sseEventText(responseCompletedEvent(generatedPagePayload(pageValue)));
  return sseChunkedStreamResponse([...deltaEvents, completed]);
}

async function readNdjson(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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

  it("keeps the existing Vercel function ceiling and caps buffered stream text without an application abort", () => {
    expect(maxDuration).toBe(120);
    expect(MAX_STREAMED_GENERATED_TEXT_LENGTH).toBeGreaterThan(90_000);
    expect(MAX_STREAMED_GENERATED_TEXT_LENGTH).toBeLessThan(maxDuration * 1_000);
  });

  it("returns application/x-ndjson and streams progress before the completed page", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(fullPageStream({ html: html(), ...ids }, ["<!doctype", " html>", "…more…"]));
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

    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.status).toBe(200);

    const events = await readNdjson(response);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const stages = events.filter((event) => event.type === "progress").map((event) => event.stage);
    expect(stages).toContain("analysing-artwork");
    expect(stages).toContain("preparing-design");
    expect(stages).toContain("building-page");
    expect(stages).toContain("checking-safety");

    const buildingProgress = events.filter(
      (event) => event.type === "progress" && event.stage === "building-page" && typeof event.receivedCharacters === "number",
    );
    expect(buildingProgress.length).toBeGreaterThan(0);
    expect(buildingProgress[0].receivedCharacters).toBeGreaterThan(0);

    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({ type: "complete", html: html(), source: "openai", inspirationUsed: true });
    expect(events[events.length - 1]).toBe(complete);

    const finalRequest = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)) as {
      stream: boolean;
      max_output_tokens: number;
      reasoning: { effort: string };
      input: Array<{ content: Array<{ type: string; text?: string; image_url?: string; detail?: string }> }>;
      text: { format: { schema: unknown } };
    };
    expect(finalRequest.stream).toBe(true);
    expect(finalRequest.max_output_tokens).toBe(10_000);
    expect(finalRequest.reasoning).toEqual({ effort: "minimal" });
    expect(finalRequest.input[0].content[0].text).toContain("Artwork owns the page identity");
    expect(finalRequest.input[0].content[0].text).toContain("bright, spacious discovery experience");
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toMatchObject({ Accept: "text/event-stream" });
    expect(JSON.stringify(finalRequest)).not.toContain("initiate_heist");
  });

  it("returns a truthful timeout-free network failure without retrying the full-page generation", async () => {
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
    const error = events.find((event) => event.type === "error");

    expect(response.status).toBe(200);
    expect(error?.error).toContain("artwork analysis succeeded");
    expect(error?.error).toContain("took too long");
    expect(error?.error).toContain("does not need to be replaced");
    expect(error?.providerError).toMatchObject({
      stage: "full-page-generation",
      provider: "openai",
      kind: "network",
      status: null,
    });
    expect((error?.providerError as { detail?: string }).detail).toContain("aborted due to timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toBe(error);
  });

  it("reports a streamed provider incomplete response without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(sseChunkedStreamResponse([sseEventText(responseIncompleteEvent("max_output_tokens"))]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ imageDataUrl: VALID_IMAGE, inspirationUrl: "" }),
    );
    const events = await readNdjson(response);
    const error = events.find((event) => event.type === "error");

    expect(error?.providerError).toMatchObject({ stage: "full-page-generation", kind: "invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a streamed provider failure without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(sseChunkedStreamResponse([sseEventText(responseFailedEvent("Upstream generation crashed"))]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ imageDataUrl: VALID_IMAGE, inspirationUrl: "" }),
    );
    const events = await readNdjson(response);
    const error = events.find((event) => event.type === "error");

    expect(error?.providerError).toMatchObject({ stage: "full-page-generation", kind: "invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps the buffered streamed text instead of growing without bound", async () => {
    const oversized = "a".repeat(MAX_STREAMED_GENERATED_TEXT_LENGTH + 1_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(sseChunkedStreamResponse([sseEventText(outputTextDeltaEvent(oversized))]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ imageDataUrl: VALID_IMAGE, inspirationUrl: "" }),
    );
    const events = await readNdjson(response);
    const error = events.find((event) => event.type === "error");

    expect(error?.providerError).toMatchObject({ stage: "full-page-generation", kind: "invalid" });
    expect((error?.providerError as { detail?: string }).detail).toContain("maximum allowed size");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries one incomplete artwork response and continues when the retry is valid", async () => {
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(incompleteResponse())
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(fullPageStream({ html: html(), ...ids }));
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
    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({ source: "openai", inspirationUsed: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      "AI artwork identity response was incomplete; retrying once",
      expect.stringContaining("max_output_tokens"),
    );
  });

  it("returns a truthful error after two incomplete artwork analyses without spending on full-page generation", async () => {
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
    const error = events.find((event) => event.type === "error");

    expect(response.status).toBe(200);
    expect(error?.error).toContain("incomplete artwork analysis twice");
    expect(error?.error).toContain("artwork has not been rejected");
    expect(error?.providerError).toMatchObject({
      stage: "page-artwork-analysis-parse",
      kind: "invalid",
      status: null,
    });
    expect((error?.providerError as { detail?: string }).detail).toContain("max_output_tokens");
    expect((error?.providerError as { detail?: string }).detail).toContain("attempt 2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a retail-inspired result that falls back to terminal and heist styling", async () => {
    const ids = getFusionBriefIds(ARTWORK, INSPIRATION);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(
        fullPageStream({ html: html("<p>root@token:~$ tokenomics.sh join the heist</p>"), ...ids }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    const events = await readNdjson(response);
    const error = events.find((event) => event.type === "error");
    expect(error?.error).toContain("legacy terminal fallback");
  });

  it("rejects a full page that echoes the wrong collaboration evidence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(inspirationResponse())
      .mockResolvedValueOnce(
        fullPageStream({
          html: html(),
          artworkBriefId: "art-deadbeef",
          inspirationBriefId: "url-deadbeef",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ imageDataUrl: VALID_IMAGE, inspirationUrl: URL }));
    const events = await readNdjson(response);
    const error = events.find((event) => event.type === "error");
    expect(error?.error).toContain("incomplete, unsafe");
  });

  it("keeps uploaded artwork mandatory", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request({ inspirationUrl: URL }));
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).not.toBe("application/x-ndjson");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("full website frontend wiring", () => {
  it("uses the full page endpoint, streams NDJSON progress, and never presents the fixed fallback as a finished result", async () => {
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
    expect(generator).toContain("response.body.getReader()");
    expect(generator).toContain('frame.setAttribute("sandbox", "allow-scripts")');
    expect(generator).toContain("frame.srcdoc = prepared");
    expect(generator).toContain("hoodlums-generated-page-height");
    expect(generator).toContain("full-page-generating");
    expect(generator).toContain("full-page-failed");
    expect(generator).toContain("The terminal-style base preview has not been accepted");
    expect(generator).toContain("previewAvailable: false");
    expect(generator).not.toContain("useState");
    expect(generator).toContain('previous?.remove()');
    expect(bridge).toContain('"/api/generate-site-page"');
  });
});
