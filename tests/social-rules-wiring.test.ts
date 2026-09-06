import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postDraft } from "@/app/api/social/draft/route";
import { POST as postVoiceSample } from "@/app/api/social/voice-sample/route";
import { GENERATE_SITE_STYLE_HEADER, resetSocialStudioRateLimitsForTests } from "@/lib/server/api-protection";
import {
  buildDraftRequestBody,
  checkDraftCompliance,
  checkDraftToneRules,
  checkDraftWordsToAvoid,
} from "@/lib/server/social-draft-pipeline";
import { buildVoiceSampleRequestBody } from "@/lib/server/social-voice-sample-pipeline";
import { resetSocialProjectSlotsStoreForTests } from "@/lib/server/social-project-slots-store";
import { resetSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";
import { DEFAULT_TONE_DIALS, DEFAULT_WORDS_TO_AVOID } from "@/lib/social-tone-rules";

const ROOT = process.cwd();
async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

const PROJECT = { name: "Test Coin", ticker: "TEST", description: "A community token.", chain: "solana", contractAddress: "" };
const SECRET = "hoodlums-test-secret";
const ORIGIN = "https://hoodlums.dev";
const WALLET = "0x1111111111111111111111111111111111111111";

function developerText(body: ReturnType<typeof buildDraftRequestBody>): string {
  return body.input[0]?.content[0]?.text ?? "";
}

describe("Settings & Rules wired into the draft prompt (6 Sep 2026)", () => {
  it("keeps the design's five words as the default ban and states them as a hard rule, replacing the old hard-coded sentence", () => {
    const text = developerText(buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini"));
    expect(text).toContain('never use any of them, in any form, in either draft: "guaranteed", "financial advice", "to the moon", "rug", "100x".');
    expect(text).not.toContain("Never use the words: guaranteed, financial advice, to the moon, rug, 100x.");
    expect(text).toContain("Never invent price predictions, guaranteed returns or financial advice.");
  });

  it("uses the project's own words and dials when supplied, and drops the ban line entirely for an empty list", () => {
    const text = developerText(
      buildDraftRequestBody(
        { project: PROJECT, voiceProfile: null, wordsToAvoid: ["moon mission"], toneDials: { humour: "dry", emoji: "none", hashtags: "never", postLength: "short" } },
        "gpt-5-mini",
      ),
    );
    expect(text).toContain('either draft: "moon mission".');
    expect(text).not.toContain('"guaranteed"');
    expect(text).toContain("Humour: dry");
    expect(text).toContain("Emoji: none — do not use a single emoji in either draft.");
    expect(text).toContain("Hashtags: never — no hashtags anywhere in either draft.");
    expect(text).toContain("Post length: short");

    const none = developerText(buildDraftRequestBody({ project: PROJECT, voiceProfile: null, wordsToAvoid: [] }, "gpt-5-mini"));
    expect(none).not.toContain("The user has banned these words");
  });

  it("keeps the reflexive-hashtag anti-formula rule unless the user has asked for lots of hashtags", () => {
    const defaults = developerText(buildDraftRequestBody({ project: PROJECT, voiceProfile: null }, "gpt-5-mini"));
    expect(defaults).toContain("Do not append hashtags to every post");
    const lots = developerText(buildDraftRequestBody({ project: PROJECT, voiceProfile: null, toneDials: { ...DEFAULT_TONE_DIALS, hashtags: "lots" } }, "gpt-5-mini"));
    expect(lots).not.toContain("Do not append hashtags to every post");
    expect(lots).toContain("the user WANTS hashtags");
  });

  it("threads the ban into the voice-sample (sorting station) prompt too, so a persona line can never carry a banned word", () => {
    const body = buildVoiceSampleRequestBody({ project: { name: "Test Coin", ticker: "TEST", description: "" }, sourcePost: "a".repeat(40), wordsToAvoid: ["rug"] }, "gpt-5-mini");
    const text = body.input[0]?.content[0]?.text ?? "";
    expect(text).toContain('either draft: "rug".');
    const without = buildVoiceSampleRequestBody({ project: { name: "Test Coin", ticker: "TEST", description: "" }, sourcePost: "a".repeat(40) }, "gpt-5-mini");
    expect(without.input[0]?.content[0]?.text ?? "").not.toContain("The user has banned these words");
  });
});

describe("deterministic checks", () => {
  it("rejects a draft containing a banned word in either channel, naming it, and passes a clean one", () => {
    expect(checkDraftWordsToAvoid({ xText: "clean post", telegramText: "still clean" }, ["rug"])).toEqual({ violated: false });
    const result = checkDraftWordsToAvoid({ xText: "gm", telegramText: "no RUG pulls here" }, ["rug", "100x"]);
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain('"rug"');
    expect(checkDraftWordsToAvoid({ xText: "rugby", telegramText: "" }, ["rug"])).toEqual({ violated: false });
    expect(checkDraftWordsToAvoid({ xText: "rug", telegramText: "" }, [])).toEqual({ violated: false });
  });

  it("enforces only the two dial settings that can be checked mechanically: no emoji, no hashtags", () => {
    expect(checkDraftToneRules({ xText: "gm 🚀", telegramText: "" }, { ...DEFAULT_TONE_DIALS, emoji: "none" }).violated).toBe(true);
    expect(checkDraftToneRules({ xText: "gm 🚀", telegramText: "" }, DEFAULT_TONE_DIALS).violated).toBe(false);
    expect(checkDraftToneRules({ xText: "gm", telegramText: "#TEST" }, { ...DEFAULT_TONE_DIALS, hashtags: "never" }).violated).toBe(true);
    expect(checkDraftToneRules({ xText: "$TEST", telegramText: "" }, { ...DEFAULT_TONE_DIALS, hashtags: "never" }).violated).toBe(false);
    expect(checkDraftToneRules({ xText: "gm 🚀 #x", telegramText: "" }, null).violated).toBe(false);
  });

  it("runs inside checkDraftCompliance, ahead of the softer style checks", () => {
    const result = checkDraftCompliance(
      { xText: "Fresh angle on the project today, keep it moving.", telegramText: "A longer note for the chat about where things stand this week." },
      { wordsToAvoid: ["angle"], toneDials: DEFAULT_TONE_DIALS },
    );
    expect(result.violated).toBe(true);
    if (result.violated) expect(result.feedback).toContain('"angle"');
  });
});

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}
function textPayload(value: Record<string, unknown>) {
  return { output: [{ content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
}
function request(url: string, body: Record<string, unknown>) {
  return new Request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": "203.0.113.30", [GENERATE_SITE_STYLE_HEADER]: SECRET },
    body: JSON.stringify(body),
  });
}

describe("routes", () => {
  beforeEach(() => {
    process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.AI_GATEWAY_API_KEY;
    resetSocialStudioRateLimitsForTests();
    resetSocialProjectSlotsStoreForTests();
  });

  afterEach(() => {
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    delete process.env.OPENAI_API_KEY;
    resetSocialStudioRateLimitsForTests();
    resetSocialStudioAuthoriserForTests();
    resetSocialProjectSlotsStoreForTests();
    vi.unstubAllGlobals();
  });

  it("draft route: a banned word in the first draft triggers the one corrective retry naming it; a clean retry is returned", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(textPayload({ xText: "Moon mission loading for Test Coin holders.", telegramText: "A calm note for the chat about the week ahead." })))
      .mockResolvedValueOnce(jsonResponse(textPayload({ xText: "Steady week for Test Coin holders, more soon.", telegramText: "A calm note for the chat about the week ahead." })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: WALLET, project: PROJECT, wordsToAvoid: ["moon mission"], toneDials: DEFAULT_TONE_DIALS }),
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { input: Array<{ content: Array<{ text: string }> }> };
    expect(retryBody.input[0].content[0].text).toContain('IMPORTANT CORRECTION (this is a regenerated attempt): The draft used banned word(s) the user told us never to say: "moon mission"');
  });

  it("draft route: when the retry still contains the banned word, no draft is returned — never fails open", async () => {
    const bad = textPayload({ xText: "Moon mission continues for Test Coin.", telegramText: "Moon mission, all aboard the chat." });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(bad)).mockResolvedValueOnce(jsonResponse(bad)));
    const response = await postDraft(request("/api/social/draft", { walletAddress: WALLET, project: PROJECT, wordsToAvoid: ["moon mission"] }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).not.toHaveProperty("draft");
  });

  it("draft route: an older client that sends neither field gets the design's defaults — behaviour before this change", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(textPayload({ xText: "A fine X post about Test Coin.", telegramText: "A fine telegram post about Test Coin." })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await postDraft(request("/api/social/draft", { walletAddress: WALLET, project: PROJECT }));
    expect(response.status).toBe(200);
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as { input: Array<{ content: Array<{ text: string }> }> };
    expect(sent.input[0].content[0].text).toContain(`"${DEFAULT_WORDS_TO_AVOID[0]}"`);
    expect(sent.input[0].content[0].text).toContain("Humour: playful");
  });

  it("voice-sample route: a reshaped sample carrying a banned word is refused (422) rather than handed to the persona bank", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(textPayload({ sample: "Test Coin is a total rug-proof vibe, trust the process." }))));
    const response = await postVoiceSample(
      request("/api/social/voice-sample", {
        walletAddress: WALLET,
        project: { name: "Test Coin", ticker: "TEST", description: "A community token." },
        sourcePost: "Macron and his wife leaving Downing Street yesterday… Apparently she just wanted to phone home.",
        wordsToAvoid: ["rug"],
      }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).not.toHaveProperty("sample");
  });
});

describe("Settings & Rules UI (source pins)", () => {
  it("renders real chips with a remove button, an inline add form, and live dials — no coming-soon badges on either block", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("aria-label={`Remove ${word}`}");
    expect(hub).toContain('placeholder="+ add a word or phrase"');
    expect(hub).toContain("addWordToAvoidFromBox();");
    expect(hub).toContain("{TONE_DIAL_OPTIONS.map((dial) => (");
    expect(hub).toContain("function updateToneDial<K extends keyof ToneDials>(key: K, value: ToneDials[K])");
    const rules = hub.slice(hub.indexOf("<h2>Words to avoid</h2>"), hub.indexOf("<h2>Direction brief"));
    expect(rules).not.toContain("<ComingSoon compact />");
    expect(rules).not.toContain("not active yet");
    expect(hub).not.toContain('const BANNED_WORDS = ["guaranteed"');
    expect(hub).not.toContain("const TONE_DIALS = [");
  });

  it("removes the Advanced rules placeholder entirely", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).not.toContain("Advanced rules");
    expect(hub).not.toContain("className={styles.advancedButton}");
  });

  it("persists both settings per project and sends them with every draft and every sorting-station sample", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("setWordsToAvoid(record.wordsToAvoid);");
    expect(hub).toContain("setToneDials(record.toneDials);");
    expect(hub).toContain("persistSocialStudio({ wordsToAvoid: result.words });");
    expect(hub).toContain("persistSocialStudio({ toneDials: next });");
    const draftCall = hub.slice(hub.indexOf('fetch("/api/social/draft"'), hub.indexOf('fetch("/api/social/draft"') + 1200);
    expect(draftCall).toContain("wordsToAvoid,\n          toneDials,");
    const sampleCall = hub.slice(hub.indexOf('fetch("/api/social/voice-sample"'), hub.indexOf('fetch("/api/social/voice-sample"') + 800);
    expect(sampleCall).toContain("wordsToAvoid,");
  });

  it("gives the remove button a 34px touch target on coarse pointers", async () => {
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".bannedPanel .wordChipRemove { min-height: 34px; min-width: 34px; }");
  });
});
