import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARTWORK_PLACEHOLDER } from "@/lib/generated-site-page";
import { createPostgresPublishStore } from "@/lib/server/postgres-publish-store";
import type { PublishableSite } from "@/lib/server/published-site-validation";

type FakeNonceRow = {
  id: string;
  nonce_hash: string;
  wallet_address: string;
  slug: string;
  wallet_chain_id: number;
  site_payload_hash: string;
  issued_at: Date;
  expires_at: Date;
  used_at: Date | null;
};

type FakeSiteRow = {
  slug: string;
  token_name: string;
  ticker: string;
  description: string;
  supply: string;
  decimals: number;
  chain: string;
  chain_id: string;
  contract_address: string;
  generated_html: string;
  artwork_reference: string;
  owner_wallet_address: string;
  x_handle: string;
  telegram: string;
  status: string;
  visibility: string;
  draft_token: string | null;
  created_at: Date;
  updated_at: Date;
};

const db = vi.hoisted(() => {
  const nonces = new Map<string, FakeNonceRow>();
  const sites = new Map<string, FakeSiteRow>();
  const calls: string[] = [];

  function reset() {
    nonces.clear();
    sites.clear();
    calls.length = 0;
  }

  function run(sql: string, params: unknown[] = []): { rows: unknown[] } {
    calls.push(sql);

    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };

    if (sql.includes("INSERT INTO wallet_nonces")) {
      const [nonceHash, walletAddress, slug, walletChainId, sitePayloadHash, issuedAt, expiresAt] =
        params as [string, string, string, number, string, Date, Date];
      const row: FakeNonceRow = {
        id: randomUUID(),
        nonce_hash: nonceHash,
        wallet_address: walletAddress,
        slug,
        wallet_chain_id: walletChainId,
        site_payload_hash: sitePayloadHash,
        issued_at: issuedAt,
        expires_at: expiresAt,
        used_at: null,
      };
      nonces.set(row.id, row);
      return { rows: [row] };
    }

    if (sql.includes("FROM wallet_nonces") && sql.includes("FOR UPDATE")) {
      const [id] = params as [string];
      const row = nonces.get(id);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes("UPDATE wallet_nonces SET used_at")) {
      const [id] = params as [string];
      const row = nonces.get(id);
      if (row) row.used_at = new Date();
      return { rows: [] };
    }

    if (sql.includes("FROM published_sites") && sql.includes("FOR UPDATE")) {
      const [slug] = params as [string];
      const row = sites.get(slug);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes("INSERT INTO published_sites")) {
      const [
        slug, tokenName, ticker, description, supply, decimals, chain, chainId,
        contractAddress, generatedHtml, artworkReference, ownerWalletAddress,
        xHandle, telegram, status, visibility, draftToken,
      ] = params as [
        string, string, string, string, string, number, string, string,
        string, string, string, string, string, string, string, string, string,
      ];
      if (sites.has(slug)) return { rows: [] };
      const now = new Date();
      const row: FakeSiteRow = {
        slug,
        token_name: tokenName,
        ticker,
        description,
        supply,
        decimals,
        chain,
        chain_id: chainId,
        contract_address: contractAddress,
        generated_html: generatedHtml,
        artwork_reference: artworkReference,
        owner_wallet_address: ownerWalletAddress,
        x_handle: xHandle,
        telegram,
        status,
        visibility,
        draft_token: draftToken,
        created_at: now,
        updated_at: now,
      };
      sites.set(slug, row);
      return { rows: [row] };
    }

    if (sql.includes("UPDATE published_sites")) {
      const [
        slug, tokenName, ticker, description, supply, decimals, chain, chainId,
        contractAddress, generatedHtml, artworkReference, xHandle, telegram, status,
      ] = params as [
        string, string, string, string, string, number, string, string,
        string, string, string, string, string, string,
      ];
      const row = sites.get(slug);
      if (!row) return { rows: [] };
      row.token_name = tokenName;
      row.ticker = ticker;
      row.description = description;
      row.supply = supply;
      row.decimals = decimals;
      row.chain = chain;
      row.chain_id = chainId;
      row.contract_address = contractAddress;
      row.generated_html = generatedHtml;
      row.artwork_reference = artworkReference;
      row.x_handle = xHandle;
      row.telegram = telegram;
      row.status = status;
      row.updated_at = new Date();
      return { rows: [row] };
    }

    if (sql.includes("FROM published_sites") && sql.includes("LIMIT 1")) {
      const [slug] = params as [string];
      const row = sites.get(slug);
      return { rows: row ? [row] : [] };
    }

    throw new Error(`Unhandled fake query: ${sql}`);
  }

  return { nonces, sites, calls, reset, run };
});

vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: () => ({
    query: (sql: string, params: unknown[]) => Promise.resolve(db.run(sql, params)),
    connect: () =>
      Promise.resolve({
        query: (sql: string, params: unknown[]) => Promise.resolve(db.run(sql, params)),
        release: () => {},
      }),
  }),
}));

const OWNER_WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

function html(marker = "Original"): string {
  const padding = `${marker} public token campaign content. `.repeat(120);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Public token</title><style>body{margin:0}</style></head><body><section id="hero"><h1>Public token</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"></section><section id="about"><p>${padding}</p></section><section id="tokenomics"><h2>Tokenomics</h2></section><section id="roadmap"><h2>Roadmap</h2></section><section id="how-to-buy"><h2>How to buy</h2></section><section id="community"><h2>Community</h2></section><script>document.body.dataset.ready="true";</script></body></html>`;
}

function site(overrides: Partial<PublishableSite> = {}): PublishableSite {
  return {
    slug: "republish-test",
    name: "Republish Token",
    ticker: "REP",
    description: "A complete public token project used for republish tests.",
    supply: "1000000000",
    decimals: 18,
    chain: "robinhood",
    chainId: "46630",
    contractAddress: "0x1111111111111111111111111111111111111111",
    generatedSiteHtml: html(),
    artworkReference:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
    xHandle: "@republish",
    telegram: "t.me/republish",
    status: "launched",
    ...overrides,
  };
}

const alwaysValid = () => Promise.resolve(true);

async function publish(
  store: ReturnType<typeof createPostgresPublishStore>,
  walletAddress: string,
  sitePayload: PublishableSite,
) {
  const challenge = await store.createChallenge({
    nonceHash: `hash-${randomUUID()}`,
    walletAddress,
    slug: sitePayload.slug,
    walletChainId: 46630,
    sitePayloadHash: `payload-${randomUUID()}`,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return store.publishWithChallenge(
    {
      challengeId: challenge.id,
      nonceHash: challenge.nonceHash,
      sitePayloadHash: challenge.sitePayloadHash,
      site: sitePayload,
    },
    alwaysValid,
  );
}

beforeEach(() => {
  db.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("postgres publish store republishing", () => {
  it("lets the owner republish their own slug and updates the stored HTML", async () => {
    const store = createPostgresPublishStore("postgres://fake");

    const first = await publish(store, OWNER_WALLET, site());
    expect(first.status).toBe("published");

    const second = await publish(store, OWNER_WALLET, site({ generatedSiteHtml: html("Updated") }));
    expect(second.status).toBe("published");
    if (second.status !== "published") throw new Error("unreachable");
    expect(second.site.generatedSiteHtml).toContain("Updated public token campaign content.");
    expect(db.sites.size).toBe(1);
  });

  it("returns slug_conflict when a different wallet publishes to an existing slug", async () => {
    const store = createPostgresPublishStore("postgres://fake");

    const first = await publish(store, OWNER_WALLET, site());
    expect(first.status).toBe("published");

    const second = await publish(store, OTHER_WALLET, site({ generatedSiteHtml: html("Hijack") }));
    expect(second.status).toBe("slug_conflict");
    expect(db.sites.get("republish-test")?.owner_wallet_address).toBe(OWNER_WALLET);
    expect(db.sites.get("republish-test")?.generated_html).not.toContain("Hijack");
  });

  it("leaves a live site's visibility as live after republishing", async () => {
    const store = createPostgresPublishStore("postgres://fake");
    await publish(store, OWNER_WALLET, site());
    const row = db.sites.get("republish-test");
    if (!row) throw new Error("site missing");
    row.visibility = "live";
    row.draft_token = null;

    const result = await publish(store, OWNER_WALLET, site({ generatedSiteHtml: html("Updated") }));
    expect(result.status).toBe("published");
    if (result.status !== "published") throw new Error("unreachable");
    expect(result.site.visibility).toBe("live");
    expect(result.site.draftToken).toBeNull();
  });

  it("leaves a draft site's visibility and draft_token untouched after republishing", async () => {
    const store = createPostgresPublishStore("postgres://fake");
    const first = await publish(store, OWNER_WALLET, site());
    if (first.status !== "published") throw new Error("unreachable");
    expect(first.site.visibility).toBe("draft");
    const originalDraftToken = first.site.draftToken;
    expect(originalDraftToken).toBeTruthy();

    const result = await publish(store, OWNER_WALLET, site({ generatedSiteHtml: html("Updated") }));
    expect(result.status).toBe("published");
    if (result.status !== "published") throw new Error("unreachable");
    expect(result.site.visibility).toBe("draft");
    expect(result.site.draftToken).toBe(originalDraftToken);
  });

  it("consumes the challenge nonce exactly once per republish", async () => {
    const store = createPostgresPublishStore("postgres://fake");
    await publish(store, OWNER_WALLET, site());
    db.calls.length = 0;

    await publish(store, OWNER_WALLET, site({ generatedSiteHtml: html("Updated") }));
    const consumeCalls = db.calls.filter((sql) => sql.includes("UPDATE wallet_nonces SET used_at"));
    expect(consumeCalls).toHaveLength(1);
  });
});
