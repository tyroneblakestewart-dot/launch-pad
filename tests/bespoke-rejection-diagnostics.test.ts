import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/route";
import {
  ARTWORK_PLACEHOLDER,
  MAX_GENERATED_HTML_BYTES,
  describeGeneratedPageRejection,
  describeGeneratedPageRejectionDetail,
  explainGeneratedPageHtmlRejection,
  formatCount,
  isCompleteGeneratedPageHtml,
  isStructurallyCompleteGeneratedPageHtml,
} from "@/lib/generated-site-page";
import {
  NO_URL_PRESENTATION_BRIEF,
  buildGeneratedSitePageRequestBody,
  buildOversizeRetryCorrectiveFeedback,
  describeGeneratedSitePageRejectionDetail,
} from "@/lib/site-page-openai-pipeline";
import { getFusionBriefIds, type ArtworkIdentity } from "@/lib/site-style-openai-pipeline";
import { buildWebsiteGenerationPipeline, rejectionCodeFromMessage } from "@/lib/server/system-health-pipeline";
import { BESPOKE_SITE_GENERATION_TIMEOUT_MS, SITE_GENERATION_TIMEOUT_MS, siteGenerationTimeoutMs } from "@/lib/site-preview-state";
import type { AdminActivityItem, AdminServiceControl } from "@/lib/admin-operations";
import { readNdjsonEvents, sseEventChunk, sseResponse } from "./generate-site-page-test-helpers";

async function source(...segments: string[]) {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

/**
 * Owner report, 11 Sep 2026: "bespoke ain't generating websites" — every
 * attempt ended on the studio's generic "AI returned a website that was
 * incomplete, unsafe, still resembled the legacy terminal fallback, or did not
 * apply the inspiration structure", and /admin's "Last generation outcome"
 * read "Not recorded". The page had been generated; our own acceptance
 * checks refused it and nothing said which rule fired.
 */
function validHtml(extra = "") {
  const padding = "Original copy shaped by the uploaded artwork. ".repeat(90);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}section{padding:40px 5vw}.grid{display:grid;grid-template-columns:1fr;gap:16px}@media(min-width:700px){.grid{grid-template-columns:repeat(3,1fr)}}</style></head><body><header><nav>Home</nav></header><section id="hero"><h1>Hello</h1><img src="${ARTWORK_PLACEHOLDER}" alt="art"><a href="{{BUY_HREF}}">Buy</a></section><section id="about"><p>${padding}</p></section><section id="how-to-buy"><ol><li>Connect</li></ol></section><section id="community"><a href="{{TELEGRAM_HREF}}">Join</a></section>${extra}<script>document.body.classList.add('ready')</script></body></html>`;
}

describe("explainGeneratedPageHtmlRejection names the rule that fired", () => {
  it("returns null for a complete page and agrees with the boolean gates", () => {
    expect(explainGeneratedPageHtmlRejection(validHtml(), {}, { measureBytes: true, checkLayout: true })).toBeNull();
    expect(isCompleteGeneratedPageHtml(validHtml())).toBe(true);
    expect(isStructurallyCompleteGeneratedPageHtml(validHtml())).toBe(true);
  });

  it("names a missing required section, the missing artwork placeholder, an external script and an unsafe embed", () => {
    expect(explainGeneratedPageHtmlRejection(validHtml().replace('id="community"', 'id="crew"'))).toMatchObject({
      code: "missing-section",
      message: 'The page has no element with the required id "community".',
    });
    expect(explainGeneratedPageHtmlRejection(validHtml().replace(ARTWORK_PLACEHOLDER, "art.png"))?.code).toBe("missing-artwork-placeholder");
    expect(explainGeneratedPageHtmlRejection(validHtml('<script src="https://cdn.example.com/x.js"></script>'))?.code).toBe("external-script");
    expect(explainGeneratedPageHtmlRejection(validHtml('<iframe src="https://example.com"></iframe>'))?.code).toBe("iframe");
    expect(explainGeneratedPageHtmlRejection(validHtml("<p>initiate_heist</p>"))?.code).toBe("forbidden-template-marker");
    expect(explainGeneratedPageHtmlRejection(42)?.code).toBe("not-a-string");
    expect(explainGeneratedPageHtmlRejection("<!doctype html><html></html>")?.code).toBe("too-short");
  });

  it("reports the size limit with the real figure, in bytes when asked (what publishing enforces)", () => {
    const oversized = validHtml(`<p>${"x".repeat(MAX_GENERATED_HTML_BYTES)}</p>`);
    const detail = explainGeneratedPageHtmlRejection(oversized, {}, { measureBytes: true });
    expect(detail?.code).toBe("too-long");
    expect(detail?.message).toContain(`${formatCount(oversized.length)} bytes, over the 90,000-byte limit`);
    expect(isCompleteGeneratedPageHtml(oversized)).toBe(false);

    // 88,000 characters of which 4,000 are emoji: under the character count, over the byte count.
    const emojiPage = validHtml(`<p>${"x".repeat(84_000 - validHtml().length)}${"🔥".repeat(2_000)}</p>`);
    expect(emojiPage.length).toBeLessThanOrEqual(MAX_GENERATED_HTML_BYTES);
    expect(new TextEncoder().encode(emojiPage).length).toBeGreaterThan(MAX_GENERATED_HTML_BYTES);
    expect(explainGeneratedPageHtmlRejection(emojiPage)).toBeNull();
    expect(explainGeneratedPageHtmlRejection(emojiPage, {}, { measureBytes: true })?.code).toBe("too-long");
    expect(isCompleteGeneratedPageHtml(emojiPage)).toBe(false);
    // Display of already-stored content stays on the looser character measure.
    expect(isStructurallyCompleteGeneratedPageHtml(emojiPage)).toBe(true);
  });

  it("only treats javascript: as unsafe where a browser would run it — a code comment is not an attack", () => {
    expect(explainGeneratedPageHtmlRejection(validHtml("<script>// JavaScript: smooth-scroll the nav</script>"))).toBeNull();
    expect(explainGeneratedPageHtmlRejection(validHtml("<!-- javascript: menu toggle below -->"))).toBeNull();
    expect(explainGeneratedPageHtmlRejection(validHtml('<a href="javascript:alert(1)">x</a>'))?.code).toBe("javascript-url");
    expect(explainGeneratedPageHtmlRejection(validHtml("<a href=' JavaScript :alert(1)'>x</a>"))?.code).toBe("javascript-url");
    expect(explainGeneratedPageHtmlRejection(validHtml('<img src="javascript:alert(1)">'))?.code).toBe("javascript-url");
    expect(explainGeneratedPageHtmlRejection(validHtml('<form action="javascript:alert(1)"></form>'))?.code).toBe("javascript-url");
    expect(explainGeneratedPageHtmlRejection(validHtml("<div style=\"background:url(javascript:alert(1))\"></div>"))?.code).toBe("javascript-url");
  });

  it("reports 'layout' last, only once every structural rule has passed", () => {
    const squished = validHtml().replace("grid-template-columns:1fr;gap:16px}@media(min-width:700px){.grid{grid-template-columns:repeat(3,1fr)}}", "grid-template-columns:repeat(3,1fr);gap:16px}");
    expect(explainGeneratedPageHtmlRejection(squished, {}, { checkLayout: true })?.code).toBe("layout");
    expect(explainGeneratedPageHtmlRejection(squished)).toBeNull();
    expect(explainGeneratedPageHtmlRejection(squished.replace('id="hero"', 'id="top"'), {}, { checkLayout: true })?.code).toBe("missing-section");
  });
});

describe("describeGeneratedPageRejectionDetail", () => {
  const evidence = { artworkBriefId: "art-1234abcd", inspirationBriefId: "url-8765dcba" };

  it("keeps the pinned ok / layout / other reasons and adds the code, message and byte size", () => {
    const ok = describeGeneratedPageRejectionDetail({ html: validHtml(), ...evidence }, evidence);
    expect(ok).toMatchObject({ reason: "ok", code: null, message: null });
    expect(ok.htmlBytes).toBe(new TextEncoder().encode(validHtml().trim()).length);
    expect(describeGeneratedPageRejection({ html: validHtml(), ...evidence }, evidence)).toBe("ok");

    const missing = describeGeneratedPageRejectionDetail({ html: validHtml().replace('id="how-to-buy"', 'id="buy"'), ...evidence }, evidence);
    expect(missing).toMatchObject({ reason: "other", code: "missing-section" });
    expect(describeGeneratedPageRejectionDetail({ html: validHtml(), artworkBriefId: "nope", inspirationBriefId: evidence.inspirationBriefId }, evidence)).toMatchObject({
      reason: "other",
      code: "evidence-mismatch",
    });
    expect(describeGeneratedPageRejectionDetail("text", evidence)).toMatchObject({ reason: "other", code: "invalid-payload", htmlBytes: null });
  });

  it("reads the provider response, naming a non-JSON answer instead of a blank 'other'", () => {
    const ids = { artworkBriefId: "art-1234abcd", inspirationBriefId: "url-8765dcba" };
    const response = (text: string) => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }] });
    expect(describeGeneratedSitePageRejectionDetail(response("```json not json"), ids)).toMatchObject({
      reason: "other",
      code: "invalid-payload",
      message: "The AI's answer was not valid JSON (16 characters).",
    });
    expect(describeGeneratedSitePageRejectionDetail({ output: [] }, ids)).toMatchObject({ code: "invalid-payload", message: "The AI returned no page text." });
    expect(describeGeneratedSitePageRejectionDetail(response(JSON.stringify({ html: validHtml(), ...ids })), ids).reason).toBe("ok");
  });
});

describe("the bespoke prompt and the oversize retry", () => {
  const ARTWORK: ArtworkIdentity = {
    dominantColours: "Powder blue, charcoal black.",
    memeEnergy: "Curious journey energy.",
    subjectAndIcons: "A child on a scooter.",
    visibleText: "None.",
    typographyPersonality: "Friendly rounded signage.",
    copyVoice: "Warm and direct.",
    nonNegotiables: "Keep the child central.",
  };
  const normalised = {
    name: "Journey",
    ticker: "RIDE",
    description: "A community token inspired by finding your route through London.",
    imageDataUrl: "data:image/png;base64,aGVsbG8=",
    inspirationUrl: "",
    xHandle: "",
    telegram: "",
  };

  it("gives the model a size target it can aim at, with the hard limit and the consequence", () => {
    const body = buildGeneratedSitePageRequestBody(normalised, "gpt-5", ARTWORK) as {
      input: Array<{ role: string; content: Array<{ text?: string }> }>;
    };
    const text = body.input[0]!.content[0]!.text!;
    expect(text).toContain("Aim for 50,000–70,000 characters of HTML in total and never exceed 80,000");
    expect(text).toContain("a longer document is rejected outright");
    expect(text).not.toContain("must stay under 85,000 characters");
  });

  it("tells the retry how far over it was and what to cut, never to truncate", () => {
    const feedback = buildOversizeRetryCorrectiveFeedback(96_412);
    expect(feedback).toContain("96,412 bytes, over the hard 90,000-byte storage limit");
    expect(feedback).toContain("no more than 70,000 characters");
    expect(feedback).toContain("Do not truncate mid-document");
  });
});

describe("POST /api/generate-site-page names the rejected rule and retries once on size", () => {
  const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
  const ARTWORK: ArtworkIdentity = {
    dominantColours: "Powder blue, charcoal black.",
    memeEnergy: "Curious journey energy.",
    subjectAndIcons: "A child on a scooter.",
    visibleText: "None.",
    typographyPersonality: "Friendly rounded signage.",
    copyVoice: "Warm and direct.",
    nonNegotiables: "Keep the child central.",
  };
  const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);

  function request() {
    return new Request("http://localhost/api/generate-site-page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Journey",
        ticker: "RIDE",
        description: "A community token inspired by finding your route through London.",
        imageDataUrl: VALID_IMAGE,
        inspirationUrl: "",
      }),
    });
  }
  function outputText(value: unknown) {
    return new Response(
      JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  function streamedPage(value: unknown) {
    return sseResponse([
      sseEventChunk({ type: "response.output_text.delta", delta: "" }),
      sseEventChunk({
        type: "response.completed",
        response: { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] },
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

  it("retries an oversize page once with the compact-page feedback and delivers the shorter second attempt", async () => {
    const oversized = validHtml(`<p>${"x".repeat(MAX_GENERATED_HTML_BYTES)}</p>`);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(streamedPage({ html: oversized, ...ids }))
      .mockResolvedValueOnce(streamedPage({ html: validHtml(), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const events = await readNdjsonEvents(await POST(request()));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string) as {
      input: Array<{ role: string; content: Array<{ text?: string }> }>;
    };
    const developerText = retryBody.input.find((item) => item.role === "developer")?.content[0]?.text || "";
    expect(developerText).toContain("CORRECTIVE FEEDBACK FROM THE REJECTED PREVIOUS ATTEMPT");
    expect(developerText).toContain(`${formatCount(oversized.length)} bytes, over the hard 90,000-byte storage limit`);
    expect(events.at(-1)?.type).toBe("complete");
  });

  it("names the rule in the error line and the provider detail when the page is refused, and records it for /admin", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(outputText(ARTWORK))
      .mockResolvedValueOnce(streamedPage({ html: validHtml().replace('id="community"', 'id="crew"'), ...ids }));
    vi.stubGlobal("fetch", fetchMock);

    const events = await readNdjsonEvents(await POST(request()));
    const errorEvent = events.at(-1) as { type: string; error: string; providerError: { stage: string; detail: string } };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errorEvent.type).toBe("error");
    expect(errorEvent.error).toBe('The AI left the page incomplete: The page has no element with the required id "community". Try again.');
    expect(errorEvent.error).not.toContain("still resembled the legacy terminal fallback");
    expect(errorEvent.providerError).toMatchObject({ stage: "full-page-generation-parse", detail: 'missing-section: The page has no element with the required id "community".' });
    expect(console.warn).toHaveBeenCalledWith(
      "Bespoke page rejected by the acceptance checks",
      expect.stringContaining('"code":"missing-section"'),
    );
  });

  it("wires the outcome into the admin Activity log and the route's time budget (source pins)", async () => {
    const route = await source("app", "api", "generate-site-page", "route.ts");
    expect(route).toContain("export const maxDuration = 800;");
    expect(route).toContain("const ROUTE_BUDGET_MS = maxDuration * 1_000;");
    expect(route).toContain("const RETRY_TIME_BUDGET_SHARE = 0.45;");
    expect(route).toContain("const retryWouldPassTimeBudget = elapsedMs > ROUTE_BUDGET_MS * RETRY_TIME_BUDGET_SHARE;");
    expect(route).toContain('kind: "bespoke-page-rejected",');
    expect(route).toContain("error: bespokeRejectionUserMessage(rejection),");
    expect(route).not.toContain("still resembled the legacy terminal fallback");
    const admin = await source("lib", "admin-operations.ts");
    expect(admin).toContain('| "bespoke-page-rejected"');
    const vercel = JSON.parse(await source("vercel.json")) as { functions: Record<string, { maxDuration: number }> };
    expect(vercel.functions["app/api/generate-site-page/route.ts"]?.maxDuration).toBe(800);
  });
});

describe("/admin website-generation pipeline reads real bespoke outcomes", () => {
  function activeControl(): AdminServiceControl {
    return { serviceKey: "website-generation", isolated: false, reason: null, updatedAt: new Date().toISOString(), updatedBy: null } as unknown as AdminServiceControl;
  }
  const now = new Date("2026-09-11T06:00:00.000Z");
  const entry = (minutesAgo: number, message: string, kind: AdminActivityItem["kind"] = "bespoke-page-rejected"): AdminActivityItem => ({
    id: `a-${minutesAgo}`,
    kind,
    serviceKey: "website-generation",
    message,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  });

  it("shows the last rejection with its rule and a breakdown by rule", async () => {
    const pipeline = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
      now,
      listActivity: async () => [
        entry(30, "Bespoke page rejected (too-long): The page is 96,412 bytes, over the 90,000-byte limit published sites are stored under. Model gpt-5, wallet 0xabc."),
        entry(90, "Bespoke page rejected (too-long): The page is 91,000 bytes. Model gpt-5, wallet 0xabc."),
        entry(200, "Bespoke page rejected (layout): The page failed the responsive-layout check. Model gpt-5, wallet 0xabc."),
        entry(10, "Bespoke layout retry skipped for wallet 0xabc.", "bespoke-cost-cap-held"),
        entry(60 * 24 * 9, "Bespoke page rejected (iframe): old. Model gpt-5, wallet 0xabc."),
      ],
    });
    const outcome = pipeline.stages.find((item) => item.id === "last-generation-outcome")!;
    expect(outcome.status).toBe("amber");
    expect(outcome.message).toContain("Last bespoke page was rejected 30 min ago: Bespoke page rejected (too-long): The page is 96,412 bytes");
    expect(outcome.observedAt).toBe(new Date(now.getTime() - 30 * 60_000).toISOString());
    const validation = pipeline.stages.find((item) => item.id === "response-validation")!;
    expect(validation.status).toBe("amber");
    expect(validation.message).toBe("3 validation rejections in the last 7 days: too-long ×2, layout ×1.");
  });

  it("goes green once the last rejection is older than a day, and stays amber with no observedAt when nothing is recorded or the log is unreadable", async () => {
    const quiet = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
      now,
      listActivity: async () => [entry(60 * 30, "Bespoke page rejected (layout): old. Model gpt-5, wallet 0xabc.")],
    });
    expect(quiet.stages.find((item) => item.id === "last-generation-outcome")).toMatchObject({ status: "green" });
    expect(quiet.stages.find((item) => item.id === "response-validation")).toMatchObject({ status: "green" });

    const empty = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
      now,
      listActivity: async () => [],
    });
    expect(empty.stages.find((item) => item.id === "last-generation-outcome")).toMatchObject({ status: "amber", observedAt: null });
    expect(empty.stages.find((item) => item.id === "response-validation")).toMatchObject({ status: "amber", observedAt: null });

    const broken = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => activeControl(),
      fetchImpl: async () => new Response(null, { status: 200 }),
      now,
      listActivity: async () => {
        throw new Error("db down");
      },
    });
    expect(broken.stages.find((item) => item.id === "last-generation-outcome")).toMatchObject({ status: "amber", observedAt: null });
    expect(rejectionCodeFromMessage("Bespoke page rejected (missing-section): x")).toBe("missing-section");
    expect(rejectionCodeFromMessage("something else")).toBe("unknown");
  });
});

describe("the studio waits as long as the route for a bespoke page", () => {
  it("keeps the 65s free-site wait and gives bespoke the route's 800s", async () => {
    expect(SITE_GENERATION_TIMEOUT_MS).toBe(65_000);
    expect(BESPOKE_SITE_GENERATION_TIMEOUT_MS).toBe(800_000);
    expect(siteGenerationTimeoutMs("free")).toBe(65_000);
    expect(siteGenerationTimeoutMs("bespoke")).toBe(800_000);
    const gate = await source("components", "build-site-gate.tsx");
    expect(gate).toContain("}, siteGenerationTimeoutMs(mode));");
  });
});
