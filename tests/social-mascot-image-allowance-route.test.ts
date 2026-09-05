import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getMascotImageUsage, POST as postMascotImage } from "@/app/api/social/mascot/image/route";
import { GENERATE_SITE_STYLE_HEADER, resetSocialStudioRateLimitsForTests } from "@/lib/server/api-protection";
import {
  createMemoryMascotImageUsageStore,
  resetMascotImageUsageStoreForTests,
  setMascotImageUsageStoreForTests,
} from "@/lib/server/mascot-image-usage-store";
import { resetSocialProjectSlotsStoreForTests } from "@/lib/server/social-project-slots-store";
import { resetSocialStudioAuthoriserForTests, setSocialStudioAuthoriserForTests } from "@/lib/server/social-studio-entitlement";
import { MAX_MASCOT_IMAGES_PER_DAY } from "@/lib/social-studio-types";

const SECRET = "hoodlums-test-secret";
const ORIGIN = "https://hoodlums.dev";
const WALLET = "0x1111111111111111111111111111111111111111";
const PROJECT = { name: "Test Coin", ticker: "TEST" };
const DNA = { characterDescription: "a green dog", colourPalette: "lime, navy", signatureProps: "chain", artStyle: "flat vector" };

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}
function post(body: Record<string, unknown>) {
  return new Request(`${ORIGIN}/api/social/mascot/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": "203.0.113.30", [GENERATE_SITE_STYLE_HEADER]: SECRET },
    body: JSON.stringify(body),
  });
}
function get(query: string) {
  return new Request(`${ORIGIN}/api/social/mascot/image?${query}`, {
    method: "GET",
    headers: { Origin: ORIGIN, [GENERATE_SITE_STYLE_HEADER]: SECRET },
  });
}
const allowed = async () => ({ status: "allowed" as const, walletAddress: WALLET, accessSource: "test-allowlist" as const });
const body = { walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", project: PROJECT, mascotVisualDNA: DNA, sceneInput: "beach" };

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
});

afterEach(() => {
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  delete process.env.OPENAI_API_KEY;
  resetSocialStudioRateLimitsForTests();
  resetSocialStudioAuthoriserForTests();
  resetSocialProjectSlotsStoreForTests();
  resetMascotImageUsageStoreForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("daily mascot-image allowance on POST /api/social/mascot/image", () => {
  it("counts each generated image and returns the running usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAAA" }] })));
    const first = await postMascotImage(post(body));
    expect(first.status).toBe(200);
    const payload = (await first.json()) as { usage: { usedToday: number; limit: number; resetsAt: string } };
    expect(payload.usage.usedToday).toBe(1);
    expect(payload.usage.limit).toBe(MAX_MASCOT_IMAGES_PER_DAY);
    expect(payload.usage.resetsAt).toMatch(/T00:00:00\.000Z$/);
  });

  it("blocks the request past the daily limit BEFORE any paid call, naming the reset", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAAA" }] }));
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < MAX_MASCOT_IMAGES_PER_DAY; index += 1) {
      expect((await postMascotImage(post(body))).status).toBe(200);
    }
    const blocked = await postMascotImage(post(body));
    expect(blocked.status).toBe(403);
    const payload = (await blocked.json()) as { code?: string; error?: string; usage?: { usedToday: number } };
    expect(payload.code).toBe("social-studio-daily-image-limit");
    expect(payload.error).toContain("resets at midnight UTC");
    expect(payload.usage?.usedToday).toBe(MAX_MASCOT_IMAGES_PER_DAY);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_MASCOT_IMAGES_PER_DAY);
  });

  it("keeps the allowance per token: a second project on the same wallet has its own two", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAAA" }] })));
    for (let index = 0; index < MAX_MASCOT_IMAGES_PER_DAY; index += 1) await postMascotImage(post(body));
    const other = await postMascotImage(post({ ...body, projectId: "proj-2" }));
    expect(other.status).toBe(200);
  });

  it("gives the reservation back when the provider call fails, so a failed image never spends the allowance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const failed = await postMascotImage(post(body));
    expect(failed.status).toBe(502);
    const usage = await getMascotImageUsage(get(`walletAddress=${WALLET}&projectId=proj-1`));
    expect(((await usage.json()) as { usage: { usedToday: number } }).usage.usedToday).toBe(0);
  });

  it("fails closed with a 503 and no image when the usage store is unavailable", async () => {
    resetMascotImageUsageStoreForTests();
    delete process.env.DATABASE_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postMascotImage(post(body));
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/social/mascot/image (today's allowance)", () => {
  it("returns the usage for a wallet + project, and 400 for a bad wallet", async () => {
    const ok = await getMascotImageUsage(get(`walletAddress=${WALLET}&projectId=proj-1`));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { usage: { usedToday: number; limit: number } }).usage).toMatchObject({ usedToday: 0, limit: MAX_MASCOT_IMAGES_PER_DAY });
    expect((await getMascotImageUsage(get("walletAddress=nope"))).status).toBe(400);
  });

  it("rejects a request without the shared secret", async () => {
    const response = await getMascotImageUsage(new Request(`${ORIGIN}/api/social/mascot/image?walletAddress=${WALLET}`, { headers: { Origin: ORIGIN } }));
    expect(response.status).toBe(401);
  });
});
