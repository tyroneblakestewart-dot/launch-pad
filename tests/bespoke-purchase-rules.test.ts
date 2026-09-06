// Bespoke money rules (owner decisions, 6 Sep 2026):
//   - a bespoke website is a one-off Bond + Pro Site purchase and nothing else
//     (Pro / Pro Bundle are Social Studio subscriptions and grant no website);
//   - each purchase buys THREE generations, after which the buyer keeps one of
//     the three designs saved in the studio or pays again;
//   - the automatic layout retry does not count, test-allowlist wallets are
//     uncapped, and the count fails closed when it cannot be read.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POST as generatePage } from "@/app/api/generate-site-page/route";
import { POST as issueChallenge } from "@/app/api/generate-site-page/challenge/route";
import {
  BESPOKE_ATTEMPTS_USED_CODE,
  BESPOKE_GENERATIONS_PER_PURCHASE,
  bespokeAttempts,
  bespokeAttemptsUsedMessage,
  hashBespokeSiteProject,
  isBespokeAttempts,
  type BespokeAttempts,
} from "@/lib/bespoke-site-access";
import { parseGenerateSitePageStreamLine } from "@/lib/generate-site-page-stream-protocol";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import {
  MAX_GENERATED_SITE_CANDIDATES,
  addGeneratedSiteCandidate,
  describeBespokeAttempts,
  orderGeneratedSiteCandidates,
} from "@/lib/generated-site-candidates";
import { GENERATE_SITE_STYLE_HEADER, resetBespokeSiteChallengeRateLimitForTests } from "@/lib/server/api-protection";
import { createMemoryBespokeSiteChallengeStore } from "@/lib/server/bespoke-site-challenge-store";
import {
  authoriseBespokeSiteGeneration,
  issueBespokeSiteGenerationChallenge,
  resetBespokeSiteAuthoriserForTests,
  resetBespokeSiteChallengeIssuerForTests,
  setBespokeSiteAuthoriserForTests,
  setBespokeSiteChallengeIssuerForTests,
} from "@/lib/server/bespoke-site-entitlement";
import {
  BespokeSiteGenerationsStoreUnavailableError,
  createMemoryBespokeSiteGenerationsStore,
  getBespokeSiteGenerationsStore,
  resetBespokeSiteGenerationsStoreForTests,
  setBespokeSiteGenerationsStoreForTests,
  type BespokeSiteGenerationsStore,
} from "@/lib/server/bespoke-site-generations-store";
import { NO_URL_PRESENTATION_BRIEF } from "@/lib/site-page-openai-pipeline";
import { getFusionBriefIds, type ArtworkIdentity } from "@/lib/site-style-openai-pipeline";
import type { BespokeSiteAccess } from "@/lib/server/subscribers";
import { buildWebsiteGenerationPipeline } from "@/lib/server/system-health-pipeline";
import { loadProjectFromStorage, saveProjectToStorage } from "@/lib/token-project-persistence";
import { getProjectBlob } from "@/lib/token-project-db";
import { toIndexEntry } from "@/lib/token-project-storage";
import type { TokenProject } from "@/lib/types";
import { createFakeIndexedDB } from "./fake-indexeddb-test-helper";
import { createFakeLocalStorage } from "./fake-local-storage-test-helper";
import { readNdjsonEvents, sseEventChunk, sseResponse } from "./generate-site-page-test-helpers";

const ROOT = process.cwd();
const ACCOUNT = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const WALLET = ACCOUNT.address as Address;
const ORIGIN = "https://hoodlums.dev";
const NOW = new Date("2026-09-06T12:00:00.000Z");
const SECRET = "test-generation-secret";
const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";
const PROJECT = {
  name: "Sherwood Cat",
  ticker: "SWCAT",
  description: "A community token with enough project detail to generate an original bespoke website.",
  inspirationUrl: "",
};
const ARTWORK: ArtworkIdentity = {
  dominantColours: "Powder blue, charcoal black, steel grey, white and restrained transit red accents.",
  memeEnergy: "Curious London journey energy with a playful child-led sense of movement and discovery.",
  subjectAndIcons: "A child studying a Tube map while standing on a scooter, with route lines, station glass and transport details.",
  visibleText: "Tube map and small London transport labels are visible but should not become the project name.",
  typographyPersonality: "Friendly rounded transport signage with clear bold headings rather than cyber or military display type.",
  copyVoice: "Warm, adventurous, direct and optimistic, written like a city journey shared with a community.",
  nonNegotiables: "Keep the child, scooter and route-map story central; do not convert the image into hacker, heist or terminal imagery.",
};

async function source(relative: string): Promise<string> {
  return readFile(path.join(ROOT, relative), "utf8");
}

function paidAccess(purchaseCount: number, walletAddress: string = WALLET): BespokeSiteAccess {
  return {
    status: "ready",
    walletAddress: walletAddress.toLowerCase(),
    allowed: true,
    tier: "bond_pro_site",
    accessSource: "paid",
    permanent: true,
    paidUntil: null,
    purchaseCount,
    message: "Permanent Bond + Pro Site access is active.",
  };
}

function testAccess(walletAddress: string = WALLET): BespokeSiteAccess {
  return {
    status: "ready",
    walletAddress: walletAddress.toLowerCase(),
    allowed: true,
    tier: "test_access",
    accessSource: "test-allowlist",
    permanent: true,
    paidUntil: null,
    purchaseCount: 0,
    message: "Admin test access is active. No payment was recorded.",
  };
}

async function seedDelivered(store: BespokeSiteGenerationsStore, count: number) {
  for (let index = 0; index < count; index += 1) {
    await store.record({ walletAddress: WALLET, projectHash: `0x${"cd".repeat(32)}`, model: "gpt-5" });
  }
}

function pageHtml() {
  const copy = "Original campaign content shaped by the uploaded journey artwork. ".repeat(105);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Journey token</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#f6fbfd;color:#15232d}header,section{padding:48px 6vw}.cards{display:grid;grid-template-columns:1fr;gap:18px}@media(min-width:700px){.cards{grid-template-columns:repeat(3,1fr)}}</style></head><body><header><nav>Discover About Roadmap Community</nav></header><section id="hero"><h1>The city is the adventure</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Journey artwork"><button>Start exploring</button></section><section id="about"><h2>About the journey</h2><p>${copy}</p></section><section id="how-to-buy"><h2>How to join</h2><ol><li>Connect</li><li>Choose</li><li>Swap</li><li>Ride</li></ol></section><section id="community"><h2>Travel together</h2><button>Join community</button></section><script>document.querySelector('img').onclick=function(){document.body.classList.toggle('celebrate')}</script></body></html>`;
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

function generateRequest() {
  return new Request(`${ORIGIN}/api/generate-site-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ ...PROJECT, imageDataUrl: VALID_IMAGE }),
  });
}

function challengeRequest() {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: ORIGIN,
    "x-forwarded-for": "203.0.113.15",
    [GENERATE_SITE_STYLE_HEADER]: SECRET,
  });
  return new Request(`${ORIGIN}/api/generate-site-page/challenge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ walletAddress: WALLET, project: PROJECT }),
  });
}

function makeProject(overrides: Partial<TokenProject> = {}): TokenProject {
  return {
    id: "project-1",
    createdAt: "2026-09-06T07:00:00.000Z",
    updatedAt: "2026-09-06T07:15:00.000Z",
    status: "draft",
    chain: "robinhood",
    name: "Sherwood Cat",
    ticker: "SWCAT",
    description: "A token with three saved designs.",
    supply: "1000000000",
    decimals: 18,
    websiteSlug: "sherwood-cat",
    contractAddress: "",
    xHandle: "",
    telegram: "",
    heroImage: "data:image/png;base64,AAAA",
    theme: "hoodlums",
    generatedSiteHtml: "<!doctype html><html><body>two</body></html>",
    generatedSiteVersion: 2,
    ...overrides,
  };
}

let generations: ReturnType<typeof createMemoryBespokeSiteGenerationsStore>;

beforeEach(() => {
  generations = createMemoryBespokeSiteGenerationsStore();
  setBespokeSiteGenerationsStoreForTests(generations);
  resetBespokeSiteAuthoriserForTests();
  resetBespokeSiteChallengeIssuerForTests();
  resetBespokeSiteChallengeRateLimitForTests();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  resetBespokeSiteAuthoriserForTests();
  resetBespokeSiteChallengeIssuerForTests();
  resetBespokeSiteChallengeRateLimitForTests();
  delete process.env.OPENAI_API_KEY;
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("attempts maths", () => {
  it("is three per recorded purchase, never negative, and floors odd inputs", () => {
    expect(BESPOKE_GENERATIONS_PER_PURCHASE).toBe(3);
    expect(bespokeAttempts(1, 0)).toEqual({ allowance: 3, used: 0, remaining: 3 });
    expect(bespokeAttempts(1, 3)).toEqual({ allowance: 3, used: 3, remaining: 0 });
    expect(bespokeAttempts(1, 7)).toEqual({ allowance: 3, used: 7, remaining: 0 });
    expect(bespokeAttempts(2, 4)).toEqual({ allowance: 6, used: 4, remaining: 2 });
    expect(bespokeAttempts(0, 0)).toEqual({ allowance: 0, used: 0, remaining: 0 });
    expect(bespokeAttempts(1.9, -2)).toEqual({ allowance: 3, used: 0, remaining: 3 });
  });

  it("recognises the wire shape and words the used-up message around keep-one-or-buy-again", () => {
    expect(isBespokeAttempts({ allowance: 3, used: 3, remaining: 0 })).toBe(true);
    expect(isBespokeAttempts({ allowance: "3", used: 3, remaining: 0 })).toBe(false);
    expect(isBespokeAttempts(null)).toBe(false);
    const message = bespokeAttemptsUsedMessage({ allowance: 3, used: 3, remaining: 0 });
    expect(message).toContain("all 3 bespoke designs");
    expect(message).toContain("Keep one of the designs");
    expect(message).toContain("buy Bond + Pro Site again for 3 more");
    expect(BESPOKE_ATTEMPTS_USED_CODE).toBe("bespoke-attempts-used");
  });

  it("describes what is left for the studio picker", () => {
    expect(describeBespokeAttempts(null)).toBeNull();
    expect(describeBespokeAttempts({ allowance: 3, used: 1, remaining: 2 })).toBe("2 of 3 designs left for this purchase.");
    expect(describeBespokeAttempts({ allowance: 3, used: 3, remaining: 0 })).toBe(
      "All 3 designs for this purchase are used — pick the one you want, or buy 3 more.",
    );
  });
});

describe("challenge issue and generation authorisation", () => {
  it("issues a challenge carrying the allowance before this generation, for a paid wallet", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    await seedDelivered(generations, 1);
    const issued = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: generations },
    );
    expect(issued.status).toBe("issued");
    if (issued.status !== "issued") throw new Error("expected a challenge");
    expect(issued.challenge.attempts).toEqual({ allowance: 3, used: 1, remaining: 2 });
  });

  it("refuses the fourth generation of one purchase with attempts-used, and a second purchase reopens it", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    await seedDelivered(generations, 3);
    const usedUp = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: generations },
    );
    expect(usedUp).toMatchObject({
      status: "attempts-used",
      walletAddress: WALLET,
      attempts: { allowance: 3, used: 3, remaining: 0 },
    });
    if (usedUp.status !== "attempts-used") throw new Error("expected attempts-used");
    expect(usedUp.message).toBe(bespokeAttemptsUsedMessage(usedUp.attempts));

    const secondPurchase = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(2), generationsStore: generations },
    );
    expect(secondPurchase.status).toBe("issued");
    if (secondPurchase.status !== "issued") throw new Error("expected a challenge");
    expect(secondPurchase.challenge.attempts).toEqual({ allowance: 6, used: 3, remaining: 3 });
  });

  it("authorises a signed challenge and re-checks the count at generation time", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    await seedDelivered(generations, 2);
    const issued = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: generations },
    );
    if (issued.status !== "issued") throw new Error("expected a challenge");
    const signature = await ACCOUNT.signMessage({ message: issued.challenge.message });
    const proof = { challengeId: issued.challenge.challengeId, nonce: issued.challenge.nonce, signature };

    // A third page was delivered (say, from another tab) between challenge and generation.
    await seedDelivered(generations, 1);
    const refused = await authoriseBespokeSiteGeneration(
      { proof, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: generations },
    );
    expect(refused).toMatchObject({ status: "attempts-used", attempts: { allowance: 3, used: 3, remaining: 0 } });
  });

  it("passes the allowance through an allowed authorisation", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    const issued = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: generations },
    );
    if (issued.status !== "issued") throw new Error("expected a challenge");
    const signature = await ACCOUNT.signMessage({ message: issued.challenge.message });
    const allowed = await authoriseBespokeSiteGeneration(
      { proof: { challengeId: issued.challenge.challengeId, nonce: issued.challenge.nonce, signature }, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: generations },
    );
    expect(allowed).toMatchObject({
      status: "allowed",
      tier: "bond_pro_site",
      accessSource: "paid",
      attempts: { allowance: 3, used: 0, remaining: 3 },
    });
  });

  it("never caps a test-allowlist wallet and never asks the count store about it", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    const counting = createMemoryBespokeSiteGenerationsStore();
    await seedDelivered(counting, 40);
    const countSpy = vi.spyOn(counting, "countForWallet");
    const issued = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => testAccess(), generationsStore: counting },
    );
    expect(issued.status).toBe("issued");
    if (issued.status !== "issued") throw new Error("expected a challenge");
    expect(issued.challenge.attempts).toBeUndefined();
    expect(countSpy).not.toHaveBeenCalled();
  });

  it("fails closed when the count cannot be read: unconfigured names the deployment, a query failure names migration 035", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    function brokenStore(error: Error): BespokeSiteGenerationsStore {
      return {
        async countForWallet() {
          throw error;
        },
        async record() {},
        async countSince() {
          return 0;
        },
        async tableExists() {
          return false;
        },
      };
    }
    const unconfigured = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: brokenStore(new BespokeSiteGenerationsStoreUnavailableError()) },
    );
    expect(unconfigured).toEqual({ status: "unavailable", message: "Bespoke generation counting is not configured on this deployment." });

    const missingTable = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: async () => paidAccess(1), generationsStore: brokenStore(new Error('relation "bespoke_site_generations" does not exist')) },
    );
    expect(missingTable.status).toBe("unavailable");
    if (missingTable.status !== "unavailable") throw new Error("expected unavailable");
    expect(missingTable.message).toContain("035_bespoke_site_generations.sql");
  });
});

describe("POST /api/generate-site-page/challenge", () => {
  beforeEach(() => {
    process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
  });

  it("returns 403 with the attempts-used code, the count and the checkout plan", async () => {
    const attempts: BespokeAttempts = { allowance: 3, used: 3, remaining: 0 };
    setBespokeSiteChallengeIssuerForTests(async () => ({
      status: "attempts-used",
      walletAddress: WALLET.toLowerCase(),
      attempts,
      message: bespokeAttemptsUsedMessage(attempts),
    }));

    const response = await issueChallenge(challengeRequest());
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      code: "bespoke-attempts-used",
      upgradeRequired: true,
      checkoutPlan: "bond-pro-site",
      attempts,
      message: bespokeAttemptsUsedMessage(attempts),
    });
  });
});

describe("POST /api/generate-site-page", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("refuses with 403 attempts-used before any AI request", async () => {
    const attempts: BespokeAttempts = { allowance: 3, used: 3, remaining: 0 };
    setBespokeSiteAuthoriserForTests(async () => ({
      status: "attempts-used",
      walletAddress: WALLET.toLowerCase(),
      attempts,
      message: bespokeAttemptsUsedMessage(attempts),
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await generatePage(generateRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "bespoke-attempts-used",
      upsell: true,
      attempts,
      message: bespokeAttemptsUsedMessage(attempts),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generations.rows).toEqual([]);
  });

  it("records one delivered page per complete stream and reports the allowance after it", async () => {
    setBespokeSiteAuthoriserForTests(async () => ({
      status: "allowed",
      walletAddress: WALLET.toLowerCase(),
      tier: "bond_pro_site",
      accessSource: "paid",
      permanent: true,
      attempts: { allowance: 3, used: 1, remaining: 2 },
    }));
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(outputText(ARTWORK)).mockResolvedValueOnce(streamedPage({ html: pageHtml(), ...ids })),
    );

    const events = await readNdjsonEvents(await generatePage(generateRequest()));
    expect(events.at(-1)).toMatchObject({ type: "complete", attempts: { allowance: 3, used: 2, remaining: 1 } });
    expect(generations.rows).toHaveLength(1);
    expect(generations.rows[0]).toMatchObject({
      walletAddress: WALLET.toLowerCase(),
      projectHash: hashBespokeSiteProject(PROJECT),
      model: "gpt-5",
    });
  });

  it("does not count a page for a test-allowlist wallet, and the complete event carries no allowance", async () => {
    setBespokeSiteAuthoriserForTests(async () => ({
      status: "allowed",
      walletAddress: WALLET.toLowerCase(),
      tier: "test_access",
      accessSource: "test-allowlist",
      permanent: true,
    }));
    const ids = getFusionBriefIds(ARTWORK, NO_URL_PRESENTATION_BRIEF);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(outputText(ARTWORK)).mockResolvedValueOnce(streamedPage({ html: pageHtml(), ...ids })),
    );

    const events = await readNdjsonEvents(await generatePage(generateRequest()));
    const complete = events.at(-1) as Record<string, unknown>;
    expect(complete.type).toBe("complete");
    expect("attempts" in complete).toBe(false);
    expect(generations.rows).toEqual([]);
  });

  it("does not count a generation that never completed", async () => {
    setBespokeSiteAuthoriserForTests(async () => ({
      status: "allowed",
      walletAddress: WALLET.toLowerCase(),
      tier: "bond_pro_site",
      accessSource: "paid",
      permanent: true,
      attempts: { allowance: 3, used: 0, remaining: 3 },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(outputText(ARTWORK)).mockResolvedValue(
        new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const events = await readNdjsonEvents(await generatePage(generateRequest()));
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(generations.rows).toEqual([]);
  });
});

describe("bespoke generations store", () => {
  it("counts per wallet case-insensitively and since a moment", async () => {
    const store = createMemoryBespokeSiteGenerationsStore();
    await store.record({ walletAddress: WALLET.toUpperCase().replace("0X", "0x"), projectHash: "0xab", model: "gpt-5" });
    await store.record({ walletAddress: WALLET, projectHash: "0xab", model: "gpt-5" });
    await store.record({ walletAddress: "0x2222222222222222222222222222222222222222", projectHash: "0xab", model: "gpt-5" });
    expect(await store.countForWallet(WALLET.toLowerCase())).toBe(2);
    expect(await store.countForWallet(WALLET)).toBe(2);
    expect(await store.countSince(new Date(Date.now() - 60_000))).toBe(3);
    expect(await store.countSince(new Date(Date.now() + 60_000))).toBe(0);
    expect(await store.tableExists()).toBe(true);
  });

  it("fails closed with no DATABASE_URL: counting and recording throw, the health stage reads no table", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    resetBespokeSiteGenerationsStoreForTests();
    try {
      const store = getBespokeSiteGenerationsStore();
      await expect(store.countForWallet(WALLET)).rejects.toBeInstanceOf(BespokeSiteGenerationsStoreUnavailableError);
      await expect(store.record({ walletAddress: WALLET, projectHash: "0xab", model: "gpt-5" })).rejects.toBeInstanceOf(
        BespokeSiteGenerationsStoreUnavailableError,
      );
      expect(await store.countSince(new Date(0))).toBe(0);
      expect(await store.tableExists()).toBe(false);
    } finally {
      if (previous !== undefined) process.env.DATABASE_URL = previous;
      setBespokeSiteGenerationsStoreForTests(generations);
    }
  });

  it("ships an idempotent migration keyed by lower-cased wallet, and the route inventory names the store", async () => {
    const sql = await source("db/migrations/035_bespoke_site_generations.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bespoke_site_generations");
    expect(sql).toContain("wallet_address VARCHAR(42) NOT NULL");
    expect(sql).toContain("project_hash VARCHAR(66) NOT NULL");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS bespoke_site_generations_wallet_idx");
    expect(sql).toContain("wallet_address ~ '^0x[0-9a-f]{40}$'");
    expect(sql).not.toContain("html");
    const store = await source("lib/server/bespoke-site-generations-store.ts");
    expect(store).toContain("WHERE wallet_address = LOWER($1)");
    expect(store).toContain("VALUES (LOWER($1), $2, $3)");
  });
});

describe("pick-from-three candidates", () => {
  it("keeps the newest three, de-duplicates identical pages, and orders oldest first for stable labels", () => {
    const t = (minute: number) => new Date(Date.UTC(2026, 8, 6, 12, minute));
    let list = addGeneratedSiteCandidate(null, "<a>", t(0), "a");
    list = addGeneratedSiteCandidate(list, "<b>", t(1), "b");
    list = addGeneratedSiteCandidate(list, "<c>", t(2), "c");
    expect(list.map((candidate) => candidate.id)).toEqual(["c", "b", "a"]);

    const deduped = addGeneratedSiteCandidate(list, "<b>", t(3), "b2");
    expect(deduped.map((candidate) => candidate.id)).toEqual(["b2", "c", "a"]);
    expect(deduped).toHaveLength(MAX_GENERATED_SITE_CANDIDATES);

    const fourth = addGeneratedSiteCandidate(list, "<d>", t(4), "d");
    expect(fourth.map((candidate) => candidate.id)).toEqual(["d", "c", "b"]);

    expect(orderGeneratedSiteCandidates(fourth).map((candidate) => candidate.id)).toEqual(["b", "c", "d"]);
    expect(fourth.map((candidate) => candidate.id)).toEqual(["d", "c", "b"]);
  });
});

describe("candidates persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());
    vi.stubGlobal("localStorage", createFakeLocalStorage());
  });

  it("stores the three designs in the IndexedDB blob, never in the localStorage index, and restores them", async () => {
    const candidates = [
      { id: "a", html: "<!doctype html><html><body>one</body></html>", createdAt: "2026-09-06T07:00:00.000Z" },
      { id: "b", html: "<!doctype html><html><body>two</body></html>", createdAt: "2026-09-06T07:05:00.000Z" },
    ];
    const project = makeProject({ generatedSiteCandidates: candidates });
    const saved = await saveProjectToStorage(project, [], null);
    expect(saved.success).toBe(true);
    if (!saved.success) throw new Error(saved.error);
    expect("generatedSiteCandidates" in saved.index[0]).toBe(false);
    expect("generatedSiteCandidates" in toIndexEntry(project)).toBe(false);

    const blob = await getProjectBlob(project.id);
    expect(blob?.generatedSiteCandidates).toEqual(candidates);

    const loaded = await loadProjectFromStorage(saved.index[0]);
    expect(loaded.success).toBe(true);
    if (!loaded.success) throw new Error(loaded.error);
    expect(loaded.project.generatedSiteCandidates).toEqual(candidates);
    expect(loaded.project.generatedSiteHtml).toBe(project.generatedSiteHtml);
  });

  it("writes no candidates key at all for a project without designs, so pre-existing blobs keep their shape", async () => {
    const project = makeProject();
    const saved = await saveProjectToStorage(project, [], null);
    expect(saved.success).toBe(true);
    const blob = await getProjectBlob(project.id);
    expect(blob).toEqual({ heroImage: project.heroImage, generatedSiteHtml: project.generatedSiteHtml });
    if (!saved.success) throw new Error(saved.error);
    const loaded = await loadProjectFromStorage(saved.index[0]);
    if (!loaded.success) throw new Error(loaded.error);
    expect("generatedSiteCandidates" in loaded.project).toBe(false);
  });
});

describe("stream protocol", () => {
  it("passes a well-formed allowance through the complete event and drops a malformed one", () => {
    const good = parseGenerateSitePageStreamLine(
      JSON.stringify({ type: "complete", html: "<p>", source: "openai", inspirationUsed: false, attempts: { allowance: 3, used: 2, remaining: 1 } }),
    );
    expect(good).toMatchObject({ type: "complete", attempts: { allowance: 3, used: 2, remaining: 1 } });
    const bad = parseGenerateSitePageStreamLine(
      JSON.stringify({ type: "complete", html: "<p>", source: "openai", inspirationUsed: false, attempts: { allowance: "3" } }),
    );
    expect(bad).toEqual({ type: "complete", html: "<p>", source: "openai", inspirationUsed: false });
  });
});

describe("website-generation health stage for the generation count (rule 10)", () => {
  const control = { key: "website-generation", label: "", description: "", affectedRoutes: "", isolated: false, reason: "", updatedAt: "2026-01-01T00:00:00.000Z" } as never;

  it("is red without a database, red without migration 035, and green with the 24h count", async () => {
    const noDatabase = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key" },
      getServiceControl: async () => control,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });
    expect(noDatabase.stages.find((entry) => entry.id === "bespoke-generations")).toMatchObject({ status: "red" });

    const missingTable = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key", DATABASE_URL: "postgres://example" },
      getServiceControl: async () => control,
      fetchImpl: async () => new Response(null, { status: 200 }),
      getBespokeGenerationsStore: () => ({ ...generations, tableExists: async () => false }),
    });
    const missing = missingTable.stages.find((entry) => entry.id === "bespoke-generations");
    expect(missing?.status).toBe("red");
    expect(missing?.message).toContain("035_bespoke_site_generations.sql");

    await seedDelivered(generations, 2);
    const healthy = await buildWebsiteGenerationPipeline({
      env: { OPENAI_API_KEY: "test-key", DATABASE_URL: "postgres://example" },
      getServiceControl: async () => control,
      fetchImpl: async () => new Response(null, { status: 200 }),
      getBespokeGenerationsStore: () => generations,
    });
    const green = healthy.stages.find((entry) => entry.id === "bespoke-generations");
    expect(green?.status).toBe("green");
    expect(green?.message).toContain("3 designs per Bond + Pro Site purchase; Pro / Pro Bundle grant no website.");
    expect(green?.message).toContain("2 bespoke page(s) delivered in the last 24h.");
  });

  it("names the admin activity kind and the store in the backend inventory", async () => {
    const admin = await source("lib/admin-operations.ts");
    expect(admin).toContain('| "bespoke-attempts-used"');
    const challenge = await source("app/api/generate-site-page/challenge/route.ts");
    expect(challenge).toContain('kind: "bespoke-attempts-used"');
  });
});

describe("studio and client wiring", () => {
  it("only ever grants the one-off purchase server-side — the Pro subscription grant is gone", async () => {
    const subscribers = await source("lib/server/subscribers.ts");
    expect(subscribers).not.toContain("An active higher-tier subscription includes bespoke site access");
    expect(subscribers).toMatch(/SELECT COUNT\(\*\)::int\s+FROM plan_payment_events payment[\s\S]*?\) AS bond_pro_site_payment_count/);
    expect(subscribers).toContain("bespokeSiteAccess: permanentBespokeAccess");
  });

  it("treats attempts-used exactly like plan-required on the client: open the Bond + Pro Site checkout", async () => {
    const bridge = await source("components/generate-site-style-auth-bridge.tsx");
    expect(bridge.match(/payload\.code === "bespoke-plan-required" \|\| payload\.code === "bespoke-attempts-used"/g)).toHaveLength(2);
    const premium = await source("components/bespoke-site-premium-controller.tsx");
    expect(premium).toContain("Bond + Pro Site buys three AI designs; keep the one you like.");
    expect(premium).toContain("three designs, keep the one you like");
  });

  it("keeps the last three designs on the project and lets the buyer choose one as the site", async () => {
    const studio = await source("components/token-studio.tsx");
    expect(studio).toContain("generatedSiteCandidates: addGeneratedSiteCandidate(current.generatedSiteCandidates, html)");
    expect(studio).toContain("setBespokeAttempts(isBespokeAttempts(detail.attempts) ? detail.attempts : null)");
    expect(studio).toContain("function chooseGeneratedDesign(candidate: GeneratedSiteCandidate)");
    expect(studio).toContain('className="site-design-picker"');
    expect(studio).toContain("Your designs · pick one");
    expect(studio).toContain('{active ? " · this one" : ""}');
    expect(studio).toContain('<p className="site-design-attempts">{bespokeAttemptsNote}</p>');
    expect(studio).toContain("{designCandidates.length > 1 ? (");

    const generator = await source("components/full-website-generator.tsx");
    expect(generator).toContain("...(event.attempts ? { attempts: event.attempts } : {})");
    expect(generator).toContain('...("attempts" in page && page.attempts ? { attempts: page.attempts } : {})');

    const css = await source("app/globals.css");
    expect(css).toContain(".site-design-picker {");
    expect(css).toContain(".site-design-option-active");

    const storage = await source("lib/token-project-storage.ts");
    expect(storage).toContain("const { heroImage, generatedSiteHtml, generatedSiteCandidates, ...entry } = project;");
  });
});
