import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/route";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import { enforceBespokeLinks } from "@/lib/bespoke-site-links";
import {
  BESPOKE_PAGE_MAX_OUTPUT_TOKENS,
  BESPOKE_PAGE_TEXT_VERBOSITY,
  NO_URL_PRESENTATION_BRIEF,
  buildBriefsComment,
  buildEmptyPageRetryCorrectiveFeedback,
  buildGeneratedSitePageRequestBody,
  describeGeneratedSitePageRejectionDetail,
  parseGeneratedPageOutputText,
  parseGeneratedSitePageResponse,
} from "@/lib/site-page-openai-pipeline";
import { getFusionBriefIds, type ArtworkIdentity } from "@/lib/site-style-openai-pipeline";
import { readNdjsonEvents, sseEventChunk, sseResponse } from "./generate-site-page-test-helpers";

async function source(...segments: string[]) {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

/**
 * Owner's /admin readout after #552 deployed (12 Sep 2026): "Bespoke page
 * rejected (too-short): The page is only 0 characters … Model gpt-5". gpt-5
 * completed the request, echoed both brief IDs, and left the `html` JSON
 * string empty. The page stage now asks for the raw HTML document instead of
 * a 70,000-character JSON string field, carries the IDs in a comment, tells
 * the model to be verbose, doubles the token ceiling so reasoning cannot
 * starve the page, and retries once when the first answer is empty.
 */
const ARTWORK: ArtworkIdentity = {
  dominantColours: "Powder blue, charcoal black.",
  memeEnergy: "Curious journey energy.",
  subjectAndIcons: "A child on a scooter.",
  visibleText: "None.",
  typographyPersonality: "Friendly rounded signage.",
  copyVoice: "Warm and direct.",
  nonNegotiables: "Keep the child central.",
};
const IDS = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";

function pageHtml(briefs = buildBriefsComment(IDS), extra = "") {
  const padding = "Original copy shaped by the uploaded artwork. ".repeat(90);
  return `<!doctype html>\n${briefs}\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}section{padding:40px 5vw}.grid{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:700px){.grid{grid-template-columns:repeat(3,1fr)}}</style></head><body><header><nav>Home</nav></header><section id="hero"><h1>Hello</h1><img src="${ARTWORK_PLACEHOLDER}" alt="art"><a href="{{BUY_HREF}}">Buy</a></section><section id="about"><p>${padding}</p></section><section id="how-to-buy"><ol><li>Connect</li></ol></section><section id="community"><a href="{{TELEGRAM_HREF}}">Join</a></section>${extra}<script>document.body.classList.add('ready')</script></body></html>`;
}

describe("parseGeneratedPageOutputText", () => {
  it("reads a raw HTML answer and the brief IDs from its comment", () => {
    const payload = parseGeneratedPageOutputText(pageHtml());
    expect(payload).toMatchObject({ artworkBriefId: IDS.artworkBriefId, inspirationBriefId: IDS.inspirationBriefId });
    expect(payload?.html).toBe(pageHtml());
    expect(parseGeneratedSitePageResponse({ output: [{ type: "message", content: [{ type: "output_text", text: pageHtml() }] }] }, IDS)?.html).toBe(pageHtml());
  });

  it("tolerates a markdown fence and leading whitespace, and a page starting at <html>", () => {
    expect(parseGeneratedPageOutputText("```html\n" + pageHtml() + "\n```")?.html).toBe(pageHtml());
    expect(parseGeneratedPageOutputText("\n\n" + pageHtml())?.html).toBe(pageHtml());
    const fromHtmlTag = pageHtml().replace("<!doctype html>\n", "");
    expect(parseGeneratedPageOutputText(fromHtmlTag)?.artworkBriefId).toBe(IDS.artworkBriefId);
  });

  it("still accepts the old JSON envelope, and reports a raw page without the comment as evidence-mismatch by name", () => {
    const legacy = JSON.stringify({ html: pageHtml(""), ...IDS });
    expect(parseGeneratedPageOutputText(legacy)).toEqual({ html: pageHtml(""), ...IDS });
    expect(parseGeneratedPageOutputText("{not json")).toBeNull();
    expect(parseGeneratedPageOutputText("Sure, here it is.")).toBeNull();
    expect(parseGeneratedPageOutputText("   ")).toBeNull();

    const noComment = { output: [{ type: "message", content: [{ type: "output_text", text: pageHtml("") }] }] };
    expect(describeGeneratedSitePageRejectionDetail(noComment, IDS)).toMatchObject({
      reason: "other",
      code: "evidence-mismatch",
      message: "The page did not carry the hoodlums-briefs comment echoing the supplied brief IDs.",
    });
    // The 12 Sep failure, exactly: a completed JSON answer with an empty html field.
    const emptyLegacy = { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ html: "", ...IDS }) }] }] };
    expect(describeGeneratedSitePageRejectionDetail(emptyLegacy, IDS)).toMatchObject({ code: "too-short", htmlBytes: 0 });
  });
});

describe("the page request", () => {
  const body = buildGeneratedSitePageRequestBody(
    { name: "Journey", ticker: "RIDE", description: "A community token inspired by finding your route through London.", imageDataUrl: VALID_IMAGE, inspirationUrl: "", xHandle: "", telegram: "" },
    "gpt-5",
    ARTWORK,
  ) as { text: unknown; max_output_tokens: number; input: Array<{ role: string; content: Array<{ text?: string }> }> };

  it("asks for the raw document with the briefs comment, no JSON envelope, high verbosity and a 64k ceiling", () => {
    const text = body.input[0]!.content[0]!.text!;
    expect(text).toContain("Your ENTIRE answer is the complete original single-file HTML document itself: raw HTML starting with <!doctype html> and ending with </html>. No JSON wrapper, no markdown fences, no commentary before or after it.");
    expect(text).toContain(`echoing both supplied brief IDs verbatim: ${buildBriefsComment(IDS)}`);
    expect(text).toContain("Output nothing but the HTML document.");
    expect(text).not.toContain("strict JSON schema");
    expect(text).not.toContain("schema-compliant JSON object");
    expect(body.text).toEqual({ verbosity: "high" });
    expect(BESPOKE_PAGE_TEXT_VERBOSITY).toBe("high");
    expect(JSON.stringify(body)).not.toContain("json_schema");
    expect(body.max_output_tokens).toBe(64_000);
    expect(BESPOKE_PAGE_MAX_OUTPUT_TOKENS).toBe(64_000);
  });

  it("tells the empty-page retry what happened and what to write", () => {
    const feedback = buildEmptyPageRetryCorrectiveFeedback(0);
    expect(feedback).toContain("returned an empty or near-empty document (0 characters)");
    expect(feedback).toContain("as raw HTML, and nothing else");
  });
});

describe("POST /api/generate-site-page with raw HTML answers", () => {
  function request() {
    return new Request("http://localhost/api/generate-site-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Journey", ticker: "RIDE", description: "A community token inspired by finding your route through London.", imageDataUrl: VALID_IMAGE, inspirationUrl: "" }),
    });
  }
  function outputText(value: unknown) {
    return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  function streamedText(text: string, usage?: Record<string, unknown>) {
    return sseResponse([
      sseEventChunk({ type: "response.output_text.delta", delta: "" }),
      sseEventChunk({
        type: "response.completed",
        response: { model: "gpt-5", ...(usage ? { usage } : {}), output: [{ type: "message", content: [{ type: "output_text", text }] }] },
      }),
    ]);
  }

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

  it("delivers a raw HTML answer as the finished page", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(outputText(ARTWORK)).mockResolvedValueOnce(streamedText(pageHtml()));
    vi.stubGlobal("fetch", fetchMock);
    const events = await readNdjsonEvents(await POST(request()));
    const complete = events.at(-1) as { type: string; html: string };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(complete.type).toBe("complete");
    expect(complete.html).toBe(enforceBespokeLinks(pageHtml(), { xHandle: "", telegram: "" }));
  });

  it("retries once when the first answer is an empty page, and delivers the second", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(streamedText(JSON.stringify({ html: "", ...IDS }), { input_tokens: 4_000, output_tokens: 900, output_tokens_details: { reasoning_tokens: 850 } }))
      .mockResolvedValueOnce(streamedText(pageHtml()));
    vi.stubGlobal("fetch", fetchMock);
    const events = await readNdjsonEvents(await POST(request()));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string) as { input: Array<{ role: string; content: Array<{ text?: string }> }> };
    const developerText = retryBody.input.find((item) => item.role === "developer")?.content[0]?.text || "";
    expect(developerText).toContain("returned an empty or near-empty document (0 characters)");
    expect(events.at(-1)?.type).toBe("complete");
  });

  it("names the empty page and records the token counts when the retry is empty too", async () => {
    const usage = { input_tokens: 4_000, output_tokens: 31_900, output_tokens_details: { reasoning_tokens: 31_850 } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(streamedText(JSON.stringify({ html: "", ...IDS }), usage))
      .mockResolvedValueOnce(streamedText(JSON.stringify({ html: "", ...IDS }), usage));
    vi.stubGlobal("fetch", fetchMock);
    const events = await readNdjsonEvents(await POST(request()));
    const errorEvent = events.at(-1) as { type: string; error: string };
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.error).toBe("The AI returned an empty or unfinished page (0 characters) and its retry did not deliver one either. Try again.");
    expect(console.warn).toHaveBeenCalledWith(
      "Bespoke page rejected by the acceptance checks",
      expect.stringContaining('"reasoning_tokens":31850'),
    );
    const route = await source("app", "api", "generate-site-page", "route.ts");
    expect(route).toContain("Output tokens ${formatCount(usage.output_tokens)} (reasoning ${formatCount(usage.output_tokens_details?.reasoning_tokens ?? 0)})");
  });
});
