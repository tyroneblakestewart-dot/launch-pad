import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postDraft } from "@/app/api/social/draft/route";
import { POST as postPostImage } from "@/app/api/social/post-image/route";
import { AI_FEATURE_KEYS, featureGroupLabel } from "@/lib/ai-feature-keys";
import { buildMascotImageUsage } from "@/lib/mascot-image-allowance";
import {
  createMemoryAiOperationCostStore,
  resetAiOperationCostStoreForTests,
  setAiOperationCostStoreForTests,
  type RecordAiOperationCostInput,
} from "@/lib/server/ai-operation-cost-store";
import { GENERATE_SITE_STYLE_HEADER, SOCIAL_POST_IMAGE_LIMIT, resetSocialStudioRateLimitsForTests } from "@/lib/server/api-protection";
import {
  createMemoryMascotImageUsageStore,
  resetMascotImageUsageStoreForTests,
  setMascotImageUsageStoreForTests,
} from "@/lib/server/mascot-image-usage-store";
import { MAX_POST_IMAGE_SCENE_LENGTH, buildPostImagePrompt, derivePostImageScene } from "@/lib/server/post-image-prompt";
import { DRAFT_ANGLES } from "@/lib/server/social-draft-pipeline";
import { resetSocialProjectSlotsStoreForTests } from "@/lib/server/social-project-slots-store";
import { resetSocialStudioAuthoriserForTests, setSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";
import {
  DEFAULT_POST_IMAGE_RANK,
  POST_IMAGE_REMOVE_NOTE,
  POST_IMAGE_VISUAL_RANK,
  describePostImageSlot,
  isPostImageEligible,
  postImageVisualRank,
  remainingAiImagesToday,
  selectPostImageCandidates,
} from "@/lib/social-post-images";
import { MAX_MASCOT_IMAGES_PER_DAY, type QueueItem } from "@/lib/social-studio-types";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

function block(text: string, start: string, length: number): string {
  const index = text.indexOf(start);
  expect(index, `expected to find ${start}`).toBeGreaterThan(-1);
  return text.slice(index, index + length);
}

function item(overrides: Partial<QueueItem> & { id: string }): QueueItem {
  return {
    xText: `Post ${overrides.id}`,
    telegramText: `Telegram ${overrides.id}`,
    artwork: null,
    source: "auto-replenish",
    dayLabel: null,
    createdAt: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-09-06T12:00:00.000Z");

describe("AI images on approved posts — which drafts the AI picks (pure)", () => {
  it("ranks every DRAFT_ANGLES key, scene-shaped angles highest and the one-liner lowest; unknown angles take the default", () => {
    for (const angle of DRAFT_ANGLES) {
      expect(POST_IMAGE_VISUAL_RANK[angle.key], angle.key).toBeTypeOf("number");
    }
    expect(postImageVisualRank("culture-observation")).toBe(3);
    expect(postImageVisualRank("milestone")).toBe(3);
    expect(postImageVisualRank("behind-the-scenes")).toBe(3);
    expect(postImageVisualRank("community-question")).toBe(2);
    expect(postImageVisualRank("one-liner")).toBe(1);
    expect(postImageVisualRank(null)).toBe(DEFAULT_POST_IMAGE_RANK);
    expect(postImageVisualRank("something-new")).toBe(DEFAULT_POST_IMAGE_RANK);
  });

  it("a draft is eligible only with text, no artwork and no 'no image' decision", () => {
    expect(isPostImageEligible(item({ id: "a" }))).toBe(true);
    expect(isPostImageEligible(item({ id: "b", artwork: "data:image/png;base64,AAAA" }))).toBe(false);
    expect(isPostImageEligible(item({ id: "c", imageDeclined: true }))).toBe(false);
    expect(isPostImageEligible(item({ id: "d", xText: "  ", telegramText: "" }))).toBe(false);
    expect(isPostImageEligible(item({ id: "e", xText: "", telegramText: "Telegram only" }))).toBe(true);
  });

  it("promises nothing until the server has answered, then exactly what is left of the day's allowance", () => {
    expect(remainingAiImagesToday(null)).toBe(0);
    expect(remainingAiImagesToday(buildMascotImageUsage(0, NOW))).toBe(MAX_MASCOT_IMAGES_PER_DAY);
    expect(remainingAiImagesToday(buildMascotImageUsage(1, NOW))).toBe(1);
    expect(remainingAiImagesToday(buildMascotImageUsage(5, NOW))).toBe(0);
    expect(describePostImageSlot(null)).toBe("AI images today: checking…");
    expect(describePostImageSlot(buildMascotImageUsage(1, NOW))).toBe("1 of 2 AI images left today");
    expect(describePostImageSlot(buildMascotImageUsage(2, NOW))).toBe("0 of 2 AI images left today");
  });

  it("picks the best angles first, oldest first on a tie, never random, capped at what is left today", () => {
    const queue = [
      item({ id: "liner", angleKey: "one-liner", createdAt: "2026-09-06T08:00:00.000Z" }),
      item({ id: "culture-new", angleKey: "culture-observation", createdAt: "2026-09-06T11:00:00.000Z" }),
      item({ id: "question", angleKey: "community-question", createdAt: "2026-09-06T09:00:00.000Z" }),
      item({ id: "culture-old", angleKey: "culture-observation", createdAt: "2026-09-06T10:00:00.000Z" }),
      item({ id: "manual", createdAt: "2026-09-06T07:00:00.000Z" }),
    ];
    expect(selectPostImageCandidates(queue, 2)).toEqual(["culture-old", "culture-new"]);
    expect(selectPostImageCandidates(queue, 3)).toEqual(["culture-old", "culture-new", "question"]);
    expect(selectPostImageCandidates(queue, 1)).toEqual(["culture-old"]);
    expect(selectPostImageCandidates(queue, 0)).toEqual([]);
    // Deterministic: the same queue always yields the same picks.
    expect(selectPostImageCandidates(queue, 2)).toEqual(selectPostImageCandidates([...queue], 2));
  });

  it("skips drafts that already carry artwork or were declined, so the pick moves to the next best draft", () => {
    const queue = [
      item({ id: "declined", angleKey: "milestone", imageDeclined: true }),
      item({ id: "has-art", angleKey: "milestone", artwork: "data:image/png;base64,AAAA" }),
      item({ id: "next", angleKey: "holder-shoutout" }),
    ];
    expect(selectPostImageCandidates(queue, 2)).toEqual(["next"]);
  });

  it("states the owner's no-remake rule plainly", () => {
    expect(POST_IMAGE_REMOVE_NOTE).toBe("Remove it and it's gone for today — AI images aren't remade until tomorrow.");
  });
});

describe("post image prompt", () => {
  const DNA = { characterDescription: "a green dog", colourPalette: "lime, navy", signatureProps: "chain", artStyle: "flat vector" };

  it("reduces a post to its scene: links, handles, hashtags and emoji dropped, whitespace collapsed, cut at a word boundary", () => {
    expect(derivePostImageScene("Late-night threads turned into strategy sessions ⚡ #DOOM https://t.co/abc @someone www.x.com")).toBe(
      "Late-night threads turned into strategy sessions",
    );
    const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
    const scene = derivePostImageScene(long);
    expect(scene.length).toBeLessThanOrEqual(MAX_POST_IMAGE_SCENE_LENGTH);
    expect(scene.endsWith("word")).toBe(false);
    expect(long.startsWith(scene)).toBe(true);
  });

  it("with a locked mascot, the post becomes the mascot's scene through the existing mascot formula", () => {
    const result = buildPostImagePrompt({
      postText: "Holders cracking jokes at 3am while the chart does its thing #DOOM",
      project: { name: "Doom", ticker: "doom" },
      mascotVisualDNA: DNA,
    });
    expect(result.mode).toBe("mascot");
    expect(result.scene).toBe("Holders cracking jokes at 3am while the chart does its thing");
    expect(result.prompt).toContain("VISUAL DNA: core colour palette");
    expect(result.prompt).toContain(result.scene);
    expect(result.prompt).toContain("Doom ($DOOM)");
  });

  it("without a mascot, builds an on-brand illustration with a hard no-text rule and the token's own facts only", () => {
    const result = buildPostImagePrompt({
      postText: "Late-night chat turned into a meme brainstorm.",
      project: { name: "Doom", ticker: "$DOOM", description: "A community token on Robinhood Chain." },
      mascotVisualDNA: null,
    });
    expect(result.mode).toBe("brand");
    expect(result.prompt).toContain("Doom ($DOOM)");
    expect(result.prompt).toContain('"Late-night chat turned into a meme brainstorm."');
    expect(result.prompt).toContain("PROJECT: A community token on Robinhood Chain.");
    expect(result.prompt).toContain("no words, letters, numbers, logos, watermarks");
    expect(result.prompt).toContain("no seed phrases, private keys or real wallet UI");
    expect(result.prompt).not.toContain("VISUAL DNA");
  });

  it("falls back to a neutral scene when the post is nothing but links and tags", () => {
    const result = buildPostImagePrompt({ postText: "#DOOM https://doom.example @doom", project: { name: "Doom", ticker: "DOOM" }, mascotVisualDNA: null });
    expect(result.scene).toBe("a moment in the token's everyday world");
  });
});

const SECRET = "hoodlums-test-secret";
const ORIGIN = "https://hoodlums.dev";
const WALLET = "0x1111111111111111111111111111111111111111";
const PROJECT = { name: "Test Coin", ticker: "TEST", description: "A community token." };

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}
function request(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "X-Forwarded-For": "203.0.113.31",
      [GENERATE_SITE_STYLE_HEADER]: SECRET,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const allowed = async () => ({ status: "allowed" as const, walletAddress: WALLET, accessSource: "test-allowlist" as const });
const body = { walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", project: PROJECT, postText: "Late-night threads turned into strategy sessions." };

describe("POST /api/social/post-image", () => {
  let costRows: RecordAiOperationCostInput[];

  beforeEach(() => {
    process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.AI_GATEWAY_API_KEY;
    resetSocialStudioRateLimitsForTests();
    resetSocialStudioAuthoriserForTests();
    resetSocialProjectSlotsStoreForTests();
    setSocialStudioAuthoriserForTests(allowed);
    setMascotImageUsageStoreForTests(createMemoryMascotImageUsageStore());
    costRows = [];
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore(costRows));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    resetSocialStudioRateLimitsForTests();
    resetSocialStudioAuthoriserForTests();
    resetSocialProjectSlotsStoreForTests();
    resetMascotImageUsageStoreForTests();
    resetAiOperationCostStoreForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a request missing the shared secret before any entitlement or AI call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postPostImage(request("/api/social/post-image", body, { [GENERATE_SITE_STYLE_HEADER]: "wrong" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the upsell shape for an unentitled wallet, spending nothing", async () => {
    setSocialStudioAuthoriserForTests(async () => ({ status: "upsell", message: "Upgrade to Pro." }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postPostImage(request("/api/social/post-image", body));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe("social-studio-plan-required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 without post text", async () => {
    const response = await postPostImage(request("/api/social/post-image", { ...body, postText: "   " }));
    expect(response.status).toBe(400);
  });

  it("rejects a slur in the post text before generating an image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postPostImage(request("/api/social/post-image", { ...body, postText: "holding up a chink coin" }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("postText");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes the image, counts it against the shared daily allowance, meters its cost and returns the running usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAAA" }] })));
    const response = await postPostImage(request("/api/social/post-image", body));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { imageDataUrl: string; usage: { usedToday: number; limit: number }; mode: string };
    expect(payload.imageDataUrl).toBe("data:image/png;base64,AAAA");
    expect(payload.usage).toMatchObject({ usedToday: 1, limit: MAX_MASCOT_IMAGES_PER_DAY });
    expect(payload.mode).toBe("brand");
    await vi.waitFor(() => expect(costRows).toHaveLength(1));
    expect(costRows[0]).toMatchObject({ featureKey: AI_FEATURE_KEYS.SOCIAL_POST_IMAGE, walletAddress: WALLET.toLowerCase(), imageCount: 1 });
    expect(AI_FEATURE_KEYS.SOCIAL_POST_IMAGE).toBe("social.post-image");
    expect(featureGroupLabel(AI_FEATURE_KEYS.SOCIAL_POST_IMAGE)).toBe("Post image");
  });

  it("uses the mascot formula when the project sends a locked visual DNA", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAAA" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const DNA = { characterDescription: "a green dog", colourPalette: "lime, navy", signatureProps: "chain", artStyle: "flat vector" };
    const response = await postPostImage(request("/api/social/post-image", { ...body, mascotVisualDNA: DNA }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { mode: string }).mode).toBe("mascot");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as { prompt: string };
    expect(sent.prompt).toContain("VISUAL DNA");
  });

  it("blocks past the day's allowance BEFORE any paid call, sharing the count with mascot scenes", async () => {
    const store = createMemoryMascotImageUsageStore();
    setMascotImageUsageStoreForTests(store);
    // Two mascot scenes already made today for this token.
    await store.reserve(WALLET, "proj-1", new Date().toISOString().slice(0, 10), MAX_MASCOT_IMAGES_PER_DAY);
    await store.reserve(WALLET, "proj-1", new Date().toISOString().slice(0, 10), MAX_MASCOT_IMAGES_PER_DAY);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postPostImage(request("/api/social/post-image", body));
    expect(response.status).toBe(403);
    const payload = (await response.json()) as { code: string; usage: { usedToday: number } };
    expect(payload.code).toBe("social-studio-daily-image-limit");
    expect(payload.usage.usedToday).toBe(MAX_MASCOT_IMAGES_PER_DAY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the reservation when the provider call fails, so a failed image never spends the allowance", async () => {
    const store = createMemoryMascotImageUsageStore();
    setMascotImageUsageStoreForTests(store);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const response = await postPostImage(request("/api/social/post-image", body));
    expect(response.status).toBe(502);
    expect(await store.usage(WALLET, "proj-1", new Date().toISOString().slice(0, 10))).toBe(0);
  });

  it("fails closed with a 503 when the allowance table cannot be read", async () => {
    resetMascotImageUsageStoreForTests();
    delete process.env.DATABASE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postPostImage(request("/api/social/post-image", body));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 on the Vercel AI Gateway fallback without spending the allowance", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AI_GATEWAY_API_KEY = "gateway-key";
    const store = createMemoryMascotImageUsageStore();
    setMascotImageUsageStoreForTests(store);
    const response = await postPostImage(request("/api/social/post-image", body));
    expect(response.status).toBe(503);
    expect(await store.usage(WALLET, "proj-1", new Date().toISOString().slice(0, 10))).toBe(0);
  });

  it("has its own per-IP limiter, sized like the mascot image's", () => {
    expect(SOCIAL_POST_IMAGE_LIMIT).toBe(20);
  });
});

describe("POST /api/social/draft returns the angle the draft was written to", () => {
  beforeEach(() => {
    process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
    process.env.OPENAI_API_KEY = "test-openai-key";
    resetSocialStudioRateLimitsForTests();
    resetSocialStudioAuthoriserForTests();
    resetSocialProjectSlotsStoreForTests();
    setSocialStudioAuthoriserForTests(allowed);
    setAiOperationCostStoreForTests(createMemoryAiOperationCostStore());
  });

  afterEach(() => {
    delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
    delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
    delete process.env.OPENAI_API_KEY;
    resetSocialStudioRateLimitsForTests();
    resetSocialStudioAuthoriserForTests();
    resetSocialProjectSlotsStoreForTests();
    resetAiOperationCostStoreForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("carries angleKey alongside the draft (one-liner at angleIndex 3), and null when a theme overrides the rotation", async () => {
    const draft = { xText: "Test Coin keeps building.", telegramText: "Test Coin keeps building, one block at a time." };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ output: [{ content: [{ type: "output_text", text: JSON.stringify(draft) }] }] })));
    const oneLinerIndex = DRAFT_ANGLES.findIndex((angle) => angle.key === "one-liner");
    const response = await postDraft(
      request("/api/social/draft", { walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", project: PROJECT, angleIndex: oneLinerIndex }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { draft?: { xText: string }; angleKey?: string | null };
    expect(payload.draft?.xText).toBe(draft.xText);
    expect(payload.angleKey).toBe("one-liner");

    const themed = await postDraft(
      request("/api/social/draft", { walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", project: PROJECT, theme: "launch week" }),
    );
    expect(themed.status).toBe(200);
    expect(((await themed.json()) as { angleKey?: string | null }).angleKey).toBeNull();
  });
});

describe("Queue tab wiring for AI images on approved posts", () => {
  it("stores the draft's angle on the queue item and re-reads the allowance when the project changes", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("angleKey: payload.angleKey ?? null,");
    expect(hub).toContain("}, [walletAddress, selectedProjectId]);");
    const types = await source("lib", "social-studio-types.ts");
    expect(types).toContain("angleKey?: string | null;");
    expect(types).toContain("imageDeclined?: boolean;");
    expect(types).toContain("aiImage?: boolean;");
  });

  it("picks from the live queue and today's remaining allowance, badges the picked rows and offers a no-cost opt-out", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("() => new Set(selectPostImageCandidates(queue, remainingAiImagesToday(mascotImageUsage))),");
    expect(hub).toContain("const isPickedForImage = postImageCandidateIds.has(item.id);");
    expect(hub).toContain("Image coming");
    expect(hub).toContain("onClick={() => declinePostImage(item.id)}");
    expect(hub).toContain("{mascotImageUsage ? ` · ${describePostImageSlot(mascotImageUsage)}` : \"\"}");
  });

  it("makes the image inside the one-tap approval, only for a picked draft with no artwork and no 'no image' decision, then posts with it", async () => {
    const hub = await source("components", "social-hub.tsx");
    const approve = block(hub, "async function approveQueueItem(item: QueueItem)", 5200);
    expect(approve).toContain("if (postImageCandidateIds.has(item.id) && !artwork && !item.imageDeclined) {");
    expect(approve).toContain("artwork = await generatePostImageForApproval(item);");
    expect(approve).toContain("artworkDataUrl: artwork || undefined,");
    expect(approve.indexOf("generatePostImageForApproval(item)")).toBeLessThan(approve.indexOf('fetch("/api/social/posts"'));
    const generate = block(hub, "async function generatePostImageForApproval(item: QueueItem)", 2600);
    expect(generate).toContain('fetch("/api/social/post-image"');
    expect(generate).toContain("postText: item.xText.trim() || item.telegramText.trim(),");
    expect(generate).toContain("if (payload.usage) setMascotImageUsage(payload.usage);");
    // A skipped image is discarded when it lands — the slot is spent, per the owner's rule.
    expect(generate).toContain("if (postImageSkippedIdsRef.current.has(item.id)) {");
    expect(generate).toContain("return await Promise.race([generated, skipped]);");
  });

  it("declining before approval passes the pick on at no cost; skipping mid-generation lets the approval continue as text", async () => {
    const hub = await source("components", "social-hub.tsx");
    const decline = block(hub, "function declinePostImage(id: string)", 400);
    expect(decline).toContain("{ ...item, imageDeclined: true }");
    const skip = block(hub, "function skipPostImage(id: string)", 500);
    expect(skip).toContain("postImageSkippedIdsRef.current.add(id);");
    expect(skip).toContain("postImageSkipResolversRef.current.get(id)?.();");
    expect(hub).not.toContain("function removePostImage");
    expect(hub).not.toContain("function attachPostImage");
  });

  it("the row shows the making state with Skip, the failure line, and states the no-remake rule before the tap", async () => {
    const hub = await source("components", "social-hub.tsx");
    expect(hub).toContain("Skip the image");
    expect(hub).toContain("The post can still be approved without one.");
    expect(hub).toContain("made when you approve from today's AI-image allowance. ${POST_IMAGE_REMOVE_NOTE}");
    expect(hub).toContain('const approveLabel = isApproving ? (postImageBusyId === item.id ? "Making the image…" : "Approving…") : "Approve";');
    const css = await source("components", "social-hub.module.css");
    expect(css).toContain(".imageComingBadge {");
    expect(css).toContain(".imageDeclineLink {");
  });

  it("is registered with the auth bridge, the admin service definition and the shared allowance's health stage", async () => {
    const bridge = await source("components", "generate-site-style-auth-bridge.tsx");
    const arrayStart = bridge.indexOf("const PROTECTED_GENERATION_ROUTES = [");
    expect(bridge.slice(arrayStart, bridge.indexOf("] as const;", arrayStart))).toContain('"/api/social/post-image"');
    const admin = await source("lib", "admin-operations.ts");
    expect(admin).toContain("/api/social/post-image");
    expect(admin).toContain('| "social-post-image-generated"');
    const pipeline = await source("lib", "server", "system-health-pipeline.ts");
    expect(pipeline).toContain("mascot scenes and approved-post images share it");
    expect(pipeline).toContain("post image ${SOCIAL_POST_IMAGE_LIMIT}");
    const route = await source("app", "api", "social", "post-image", "route.ts");
    expect(route).toContain('kind: "social-post-image-generated"');
    expect(route).not.toContain("postText}");
  });
});
