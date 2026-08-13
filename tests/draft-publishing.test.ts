import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import PublicGeneratedSitePage, { generateMetadata } from "@/app/[slug]/page";
import { POST as createChallenge } from "@/app/api/publish/challenge/route";
import { POST as changeVisibility } from "@/app/api/publish/visibility/route";
import { notFound } from "next/navigation";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import { resetPublishRateLimitsForTests } from "@/lib/server/api-protection";
import type { PublishChallenge } from "@/lib/server/publish-auth";
import {
  resetPublicGeneratedSiteAdapterForTests,
  setPublicGeneratedSiteAdapter,
} from "@/lib/server/public-generated-sites";
import {
  resetPublishStoreForTests,
  setPublishStoreForTests,
  type CreatePublishChallengeInput,
  type PublishSignatureVerifier,
  type PublishStore,
  type PublishStoreResult,
  type PublishVisibilityResult,
  type SetVisibilityWithChallengeInput,
} from "@/lib/server/publish-store";

const ROOT = process.cwd();
const OWNER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const OTHER = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d5a8b9c7f8b4f5a33c56c2f4ec1d0e1c7f5b3a2" as `0x${string}`,
);
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";
const ARTWORK = `data:image/png;base64,${PNG_BASE64}`;

function generatedHtml(): string {
  const copy = "Draft publishing test content. ".repeat(150);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Draft</title><style>body{margin:0}@media(max-width:700px){body{margin:0}}</style></head><body><section id="hero"><img src="${ARTWORK_PLACEHOLDER}"></section><section id="about">${copy}</section><section id="tokenomics">Supply</section><section id="roadmap">Roadmap</section><section id="how-to-buy">Buy</section><section id="community">Community</section><script>1;</script></body></html>`;
}

function sitePayload(slug = "draft-token") {
  return {
    slug,
    name: "Draft Token",
    ticker: "DRAFT",
    description: "A complete draft token description used for visibility tests.",
    supply: "1000000000",
    decimals: 18,
    chain: "robinhood",
    chainId: "46630",
    contractAddress: "0x1111111111111111111111111111111111111111",
    generatedSiteHtml: generatedHtml(),
    artworkReference: ARTWORK,
    xHandle: "@draft",
    telegram: "t.me/draft",
    status: "prepared",
  } as const;
}

const DRAFT_FIXTURE: PublicGeneratedSite = {
  slug: "draft-token",
  name: "Draft Token",
  ticker: "DRAFT",
  description: "A complete draft token description used for visibility tests.",
  supply: "1000000000",
  decimals: 18,
  chain: "robinhood",
  heroImage: ARTWORK,
  generatedSiteHtml: generatedHtml(),
  contractAddress: "",
  xHandle: "",
  telegram: "",
  status: "prepared",
  visibility: "draft",
  draftToken: "unguessable-draft-token-value",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function notFoundDigest(): string {
  try {
    notFound();
  } catch (error) {
    return (error as { digest?: string }).digest || "";
  }
  throw new Error("notFound() did not throw");
}

class VisibilityStore implements PublishStore {
  readonly challenges = new Map<string, PublishChallenge>();
  site: PublicGeneratedSite = { ...DRAFT_FIXTURE };
  ownerWalletAddress = OWNER.address;

  async createChallenge(input: CreatePublishChallengeInput): Promise<PublishChallenge> {
    const challenge: PublishChallenge = { id: randomUUID(), ...input, usedAt: null };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async publishWithChallenge(): Promise<PublishStoreResult> {
    throw new Error("Not used by visibility tests");
  }

  async setVisibilityWithChallenge(
    input: SetVisibilityWithChallengeInput,
    verifySignature: PublishSignatureVerifier,
  ): Promise<PublishVisibilityResult> {
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge) return { status: "nonce_not_found" };
    if (challenge.usedAt) return { status: "nonce_replayed" };
    if (challenge.expiresAt.getTime() <= Date.now()) return { status: "nonce_expired" };
    if (challenge.nonceHash !== input.nonceHash || challenge.slug !== input.slug) {
      return { status: "nonce_mismatch" };
    }
    if (!(await verifySignature(challenge))) return { status: "invalid_signature" };
    if (challenge.walletAddress.toLowerCase() !== this.ownerWalletAddress.toLowerCase()) {
      return { status: "not_owner" };
    }
    challenge.usedAt = new Date();
    this.site = { ...this.site, visibility: "live", draftToken: null };
    return { status: "updated", site: this.site, ownerWalletAddress: challenge.walletAddress };
  }

  async getBySlug(slug: string): Promise<PublicGeneratedSite | null> {
    return slug === this.site.slug ? this.site : null;
  }

  async listLive(): Promise<PublicGeneratedSite[]> {
    return this.site.visibility === "draft" ? [] : [this.site];
  }
}

function post(pathname: string, body: unknown) {
  return new Request(`http://localhost:3000${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      "X-Forwarded-For": "203.0.113.90",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.PUBLISH_ALLOWED_ORIGIN = "http://localhost:3000";
  resetPublishRateLimitsForTests();
});

afterEach(() => {
  delete process.env.PUBLISH_ALLOWED_ORIGIN;
  resetPublishStoreForTests();
  resetPublicGeneratedSiteAdapterForTests();
});

describe("draft public route visibility", () => {
  it("returns notFound without a token or with the wrong token, and renders with the correct token", async () => {
    setPublicGeneratedSiteAdapter(async () => DRAFT_FIXTURE);
    const digest = notFoundDigest();

    await expect(
      PublicGeneratedSitePage({ params: Promise.resolve({ slug: "draft-token" }) }),
    ).rejects.toMatchObject({ digest });
    await expect(
      PublicGeneratedSitePage({
        params: Promise.resolve({ slug: "draft-token" }),
        searchParams: Promise.resolve({ preview: "wrong-token" }),
      }),
    ).rejects.toMatchObject({ digest });
    await expect(
      PublicGeneratedSitePage({
        params: Promise.resolve({ slug: "draft-token" }),
        searchParams: Promise.resolve({ preview: DRAFT_FIXTURE.draftToken as string }),
      }),
    ).resolves.toMatchObject({ type: "main" });
  });

  it("emits noindex, nofollow for drafts while live pages keep normal metadata", async () => {
    setPublicGeneratedSiteAdapter(async () => DRAFT_FIXTURE);
    const draftMetadata = await generateMetadata({
      params: Promise.resolve({ slug: "draft-token" }),
      searchParams: Promise.resolve({ preview: DRAFT_FIXTURE.draftToken as string }),
    });
    expect(draftMetadata.robots).toEqual({ index: false, follow: false });

    setPublicGeneratedSiteAdapter(async () => ({ ...DRAFT_FIXTURE, visibility: "live", draftToken: null }));
    const liveMetadata = await generateMetadata({ params: Promise.resolve({ slug: "draft-token" }) });
    expect(liveMetadata.robots).toBeUndefined();
  });
});

describe("POST /api/publish/visibility", () => {
  it("rejects a valid signature from a wallet that is not the stored site owner", async () => {
    const store = new VisibilityStore();
    setPublishStoreForTests(store);
    const challengeResponse = await createChallenge(
      post("/api/publish/challenge", {
        walletAddress: OTHER.address,
        walletChainId: 46630,
        site: sitePayload(),
      }),
    );
    expect(challengeResponse.status).toBe(201);
    const challenge = await challengeResponse.json() as {
      challengeId: string;
      nonce: string;
      message: string;
    };
    const signature = await OTHER.signMessage({ message: challenge.message });

    const response = await changeVisibility(
      post("/api/publish/visibility", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        slug: "draft-token",
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("not the owner") });
    expect(store.site.visibility).toBe("draft");
  });
});

describe("studio draft publishing wiring", () => {
  it("omits walletAddress from the publish payload, opens only from the view tap, and creates no extra iframe", async () => {
    const generator = await readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
    const publishStart = generator.indexOf('fetch("/api/publish",');
    const publishEnd = generator.indexOf("});", publishStart);
    const publishRequest = generator.slice(publishStart, publishEnd);
    expect(publishRequest).toContain("JSON.stringify({ challengeId, nonce, signature, site })");
    expect(publishRequest).not.toContain("walletAddress");

    const viewStart = generator.indexOf("const onViewDraft = () => {");
    const viewEnd = generator.indexOf("};", viewStart);
    expect(generator.slice(viewStart, viewEnd)).toContain('window.open(destinationUrl, "_blank"');
    expect(generator).toContain("listen(viewDraftButton, onViewDraft);");
    expect((generator.match(/document\.createElement\("iframe"\)/g) || []).length).toBe(1);
    expect(generator).not.toContain("useState");
  });
});

describe("draft visibility migration", () => {
  it("moves existing rows to live and defaults future rows to draft", async () => {
    const migration = await readFile(path.join(ROOT, "db", "migrations", "002_draft_visibility.sql"), "utf8");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS visibility TEXT");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS draft_token TEXT");
    expect(migration).toContain("SET visibility = 'live'");
    expect(migration).toContain("ALTER COLUMN visibility SET DEFAULT 'draft'");
    expect(migration).toContain("CHECK (visibility IN ('draft', 'live'))");
  });
});
