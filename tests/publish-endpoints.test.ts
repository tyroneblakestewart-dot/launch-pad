import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import PublicGeneratedSitePage from "@/app/[slug]/page";
import { POST as createChallenge } from "@/app/api/publish/challenge/route";
import { POST as publishSite } from "@/app/api/publish/route";
import { PublicSiteFrame } from "@/components/public-site-frame";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { resetPublishRateLimitsForTests } from "@/lib/server/api-protection";
import type { PublishChallenge } from "@/lib/server/publish-auth";
import {
  resetPublicGeneratedSiteAdapterForTests,
} from "@/lib/server/public-generated-sites";
import {
  resetPublishStoreForTests,
  setPublishStoreForTests,
  type CreatePublishChallengeInput,
  type PublishSignatureVerifier,
  type PublishStore,
  type PublishStoreResult,
  type PublishWithChallengeInput,
} from "@/lib/server/publish-store";

const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const OTHER_ACCOUNT = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d5a8b9c7f8b4f5a33c56c2f4ec1d0e1c7f5b3a2" as `0x${string}`,
);
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=";
const ARTWORK_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

function validGeneratedHtml(): string {
  const padding = "Original public token campaign content. ".repeat(120);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Public token</title><style>body{margin:0}</style></head><body><section id="hero"><h1>Public token</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"></section><section id="about"><p>${padding}</p></section><section id="tokenomics"><h2>Tokenomics</h2></section><section id="roadmap"><h2>Roadmap</h2></section><section id="how-to-buy"><h2>How to buy</h2></section><section id="community"><h2>Community</h2></section><script>document.body.dataset.ready="true";</script></body></html>`;
}

function sitePayload(slug = "published-token") {
  return {
    slug,
    name: "Published Token",
    ticker: "PUB",
    description: "A complete public token project created for signed publishing tests.",
    supply: "1000000000",
    decimals: 18,
    chain: "robinhood",
    chainId: "46630",
    contractAddress: "0x1111111111111111111111111111111111111111",
    generatedSiteHtml: validGeneratedHtml(),
    artworkReference: ARTWORK_DATA_URL,
    xHandle: "@published",
    telegram: "t.me/published",
    status: "launched",
  };
}

class MemoryPublishStore implements PublishStore {
  readonly challenges = new Map<string, PublishChallenge>();
  readonly sites = new Map<string, PublicGeneratedSite>();

  async createChallenge(input: CreatePublishChallengeInput): Promise<PublishChallenge> {
    const challenge: PublishChallenge = {
      id: randomUUID(),
      ...input,
      usedAt: null,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  async publishWithChallenge(
    input: PublishWithChallengeInput,
    verifySignature: PublishSignatureVerifier,
  ): Promise<PublishStoreResult> {
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge) return { status: "nonce_not_found" };
    if (challenge.usedAt) return { status: "nonce_replayed" };
    if (challenge.expiresAt.getTime() <= Date.now()) return { status: "nonce_expired" };
    if (
      challenge.nonceHash !== input.nonceHash ||
      challenge.slug !== input.site.slug ||
      challenge.sitePayloadHash !== input.sitePayloadHash
    ) {
      return { status: "nonce_mismatch" };
    }
    if (!(await verifySignature(challenge))) return { status: "invalid_signature" };

    challenge.usedAt = new Date();
    if (this.sites.has(input.site.slug)) return { status: "slug_conflict" };

    const now = new Date().toISOString();
    const site: PublicGeneratedSite = {
      slug: input.site.slug,
      name: input.site.name,
      ticker: input.site.ticker,
      description: input.site.description,
      supply: input.site.supply,
      decimals: input.site.decimals,
      chain: input.site.chain,
      heroImage: input.site.artworkReference,
      generatedSiteHtml: input.site.generatedSiteHtml,
      contractAddress: input.site.contractAddress,
      xHandle: input.site.xHandle,
      telegram: input.site.telegram,
      status: input.site.status,
      createdAt: now,
      updatedAt: now,
    };
    this.sites.set(site.slug, site);
    return { status: "published", site, ownerWalletAddress: challenge.walletAddress };
  }

  async getBySlug(slug: string): Promise<PublicGeneratedSite | null> {
    return this.sites.get(slug) || null;
  }
}

function postRequest(path: string, body: unknown, ip = "203.0.113.10") {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify(body),
  });
}

type SitePayload = ReturnType<typeof sitePayload>;

async function requestSignedChallenge(
  slug: string,
  signer = ACCOUNT,
  site: SitePayload = sitePayload(slug),
) {
  const challengeResponse = await createChallenge(
    postRequest("/api/publish/challenge", {
      walletAddress: signer.address,
      walletChainId: 46630,
      site,
    }),
  );
  expect(challengeResponse.status).toBe(201);
  return challengeResponse.json() as Promise<{
    challengeId: string;
    nonce: string;
    message: string;
    sitePayloadHash: string;
  }>;
}

async function signedPublish(
  store: MemoryPublishStore,
  options: {
    slug?: string;
    signer?: typeof ACCOUNT;
    signatureSigner?: typeof ACCOUNT;
    challengeSite?: SitePayload;
    publishSite?: SitePayload;
  } = {},
) {
  const slug = options.slug || "published-token";
  const signer = options.signer || ACCOUNT;
  const challengeSite = options.challengeSite || sitePayload(slug);
  const challenge = await requestSignedChallenge(slug, signer, challengeSite);
  const signature = await (options.signatureSigner || signer).signMessage({ message: challenge.message });
  const response = await publishSite(
    postRequest("/api/publish", {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      signature,
      site: options.publishSite || challengeSite,
    }),
  );
  return { challenge, response, store };
}

beforeEach(() => {
  process.env.PUBLISH_ALLOWED_ORIGIN = "http://localhost:3000";
  resetPublishRateLimitsForTests();
  resetPublicGeneratedSiteAdapterForTests();
});

afterEach(() => {
  delete process.env.PUBLISH_ALLOWED_ORIGIN;
  resetPublishStoreForTests();
  resetPublicGeneratedSiteAdapterForTests();
});

describe("signed public publishing", () => {
  it("accepts a valid wallet signature, stores the site, and returns its public URL", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const { response, challenge } = await signedPublish(store);
    expect(challenge.message).toContain(`Site Payload Hash: ${challenge.sitePayloadHash}`);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      published: true,
      publicUrl: "https://hoodlums.dev/published-token",
      ownerWalletAddress: ACCOUNT.address,
    });
    expect(store.sites.get("published-token")?.generatedSiteHtml).toContain("Public token");
  });

  it("rejects a signature made by a different wallet", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const { response } = await signedPublish(store, { signatureSigner: OTHER_ACCOUNT });
    expect(response.status).toBe(401);
    expect(store.sites.size).toBe(0);
  });

  it("rejects site content altered after the wallet signs the challenge", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);
    const original = sitePayload("payload-bound-token");
    const changed = {
      ...original,
      description: "A different public description substituted after the wallet signed the original payload.",
    };

    const { response } = await signedPublish(store, {
      slug: "payload-bound-token",
      challengeSite: original,
      publishSite: changed,
    });
    expect(response.status).toBe(401);
    expect(store.sites.size).toBe(0);
  });

  it("rejects an expired nonce", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const challenge = await requestSignedChallenge("expired-token");
    store.challenges.get(challenge.challengeId)!.expiresAt = new Date(Date.now() - 1);
    const signature = await ACCOUNT.signMessage({ message: challenge.message });

    const response = await publishSite(
      postRequest("/api/publish", {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature,
        site: sitePayload("expired-token"),
      }),
    );
    expect(response.status).toBe(410);
    expect(store.sites.size).toBe(0);
  });

  it("rejects replay of a successfully consumed nonce", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const first = await signedPublish(store, { slug: "one-use-token" });
    expect(first.response.status).toBe(201);
    const signature = await ACCOUNT.signMessage({ message: first.challenge.message });
    const replay = await publishSite(
      postRequest("/api/publish", {
        challengeId: first.challenge.challengeId,
        nonce: first.challenge.nonce,
        signature,
        site: sitePayload("one-use-token"),
      }),
    );
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toMatchObject({
      error: expect.stringContaining("already been used"),
    });
  });

  it("returns a deterministic conflict when the database uniqueness boundary rejects the slug", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);

    const first = await signedPublish(store, { slug: "unique-token" });
    expect(first.response.status).toBe(201);
    const second = await signedPublish(store, {
      slug: "unique-token",
      signer: OTHER_ACCOUNT,
    });
    expect(second.response.status).toBe(409);
    await expect(second.response.json()).resolves.toMatchObject({
      error: expect.stringContaining("already published"),
    });
  });

  it("serves a successfully published site through the existing public slug route", async () => {
    const store = new MemoryPublishStore();
    setPublishStoreForTests(store);
    const { response } = await signedPublish(store, { slug: "public-render" });
    expect(response.status).toBe(201);

    const element = await PublicGeneratedSitePage({
      params: Promise.resolve({ slug: "public-render" }),
    });
    const children = element.props.children as unknown[];
    const frame = children[0] as { type: unknown; props: { html: string } };
    expect(frame.type).toBe(PublicSiteFrame);
    expect(frame.props.html).toContain(ARTWORK_DATA_URL);
    expect(frame.props.html).not.toContain(ARTWORK_PLACEHOLDER);
  });
});
