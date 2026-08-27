import { describe, expect, it, vi } from "vitest";
import { createPostgresPublishStore, type PostgresPoolLike } from "@/lib/server/postgres-publish-store";
import type { PublishableSite } from "@/lib/server/published-site-validation";
import type { PublishWithChallengeInput } from "@/lib/server/publish-store";

const CHALLENGE_ID = "11111111-1111-1111-1111-111111111111";
const WALLET = "0xAbC1230000000000000000000000000000dEaD";
const NONCE_HASH = "nonce-hash-123";
const SITE_PAYLOAD_HASH = "site-payload-hash-456";
const SLUG = "my-token";
const ARTWORK_PLACEHOLDER = "{{HOODLUMS_ARTWORK}}";

function validGeneratedHtml(): string {
  const padding = "Original public token campaign content. ".repeat(120);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Public token</title><style>body{margin:0}@media(max-width:700px){body{margin:0}}</style></head><body><section id="hero"><h1>Public token</h1><img src="${ARTWORK_PLACEHOLDER}" alt="Artwork"></section><section id="about"><p>${padding}</p></section><section id="tokenomics"><h2>Tokenomics</h2></section><section id="roadmap"><h2>Roadmap</h2></section><section id="how-to-buy"><h2>How to buy</h2></section><section id="community"><h2>Community</h2></section><script>document.body.dataset.ready="true";</script></body></html>`;
}

function publishableSite(overrides: Partial<PublishableSite> = {}): PublishableSite {
  return {
    slug: SLUG,
    name: "My Token",
    ticker: "MYT",
    description: "A complete token project used for republish store tests.",
    supply: "1000000000",
    decimals: 18,
    chain: "robinhood",
    chainId: "46630",
    contractAddress: "0x1111111111111111111111111111111111111111",
    generatedSiteHtml: validGeneratedHtml(),
    artworkReference: "",
    xHandle: "@mytoken",
    telegram: "t.me/mytoken",
    status: "launched",
    ...overrides,
  };
}

function publishInput(overrides: Partial<PublishWithChallengeInput> = {}): PublishWithChallengeInput {
  return {
    challengeId: CHALLENGE_ID,
    nonceHash: NONCE_HASH,
    sitePayloadHash: SITE_PAYLOAD_HASH,
    site: publishableSite(),
    ...overrides,
  };
}

function nonceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHALLENGE_ID,
    nonce_hash: NONCE_HASH,
    wallet_address: WALLET,
    slug: SLUG,
    wallet_chain_id: 46630,
    site_payload_hash: SITE_PAYLOAD_HASH,
    issued_at: new Date("2026-01-01T00:00:00.000Z"),
    expires_at: new Date("2999-01-01T00:00:00.000Z"),
    used_at: null,
    ...overrides,
  };
}

function publishedSiteRow(overrides: Record<string, unknown> = {}) {
  return {
    slug: SLUG,
    token_name: "My Token",
    ticker: "MYT",
    description: "A complete token project used for republish store tests.",
    supply: "1000000000",
    decimals: 18,
    chain: "robinhood",
    chain_id: "46630",
    contract_address: "0x1111111111111111111111111111111111111111",
    generated_html: validGeneratedHtml(),
    artwork_reference: "",
    owner_wallet_address: WALLET,
    x_handle: "@mytoken",
    telegram: "t.me/mytoken",
    status: "launched",
    visibility: "live",
    draft_token: null,
    lp_locked_at: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

type FakeQueryCall = { text: string; params?: unknown[] };

function createFakeClient(responses: Array<[match: string, rows: unknown[]]>) {
  const calls: FakeQueryCall[] = [];
  return {
    calls,
    release: vi.fn(),
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.startsWith("UPDATE wallet_nonces SET used_at")) return { rows: [] };
      const found = responses.find(([match]) => text.includes(match));
      if (!found) throw new Error(`No fake response configured for query: ${text.slice(0, 160)}`);
      return { rows: found[1] };
    }),
  };
}

function createFakePool(client: ReturnType<typeof createFakeClient>): PostgresPoolLike {
  return {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => {
      throw new Error("pool.query should not be called by publishWithChallenge");
    }),
  };
}

const alwaysValidSignature = async () => true;

describe("createPostgresPublishStore.publishWithChallenge", () => {
  it("issues an upsert with a case-insensitive owner guard, updating only the allowed columns", async () => {
    const client = createFakeClient([
      ["FROM wallet_nonces", [nonceRow()]],
      ["INSERT INTO published_sites", [publishedSiteRow()]],
    ]);
    const pool = createFakePool(client);
    const store = createPostgresPublishStore("postgres://test", { getPool: () => pool });

    await store.publishWithChallenge(publishInput(), alwaysValidSignature);

    const insertCall = client.calls.find((call) => call.text.includes("INSERT INTO published_sites"));
    expect(insertCall).toBeDefined();
    const sql = insertCall!.text;

    expect(sql).toContain("ON CONFLICT (slug) DO UPDATE SET");
    expect(sql).toContain(
      "WHERE lower(published_sites.owner_wallet_address) = lower(EXCLUDED.owner_wallet_address)",
    );

    const updateSetSection = sql.slice(sql.indexOf("DO UPDATE SET"), sql.indexOf("WHERE lower"));
    for (const protectedColumn of ["visibility", "draft_token", "owner_wallet_address", "lp_locked_at", "created_at"]) {
      expect(updateSetSection).not.toContain(protectedColumn);
    }

    for (const allowedColumn of [
      "token_name",
      "ticker",
      "description",
      "supply",
      "decimals",
      "chain",
      "chain_id",
      "contract_address",
      "generated_html",
      "artwork_reference",
      "x_handle",
      "telegram",
      "status",
    ]) {
      expect(updateSetSection).toContain(`${allowedColumn} = EXCLUDED.${allowedColumn}`);
    }
  });

  it("maps a returned row to status published", async () => {
    const client = createFakeClient([
      ["FROM wallet_nonces", [nonceRow()]],
      ["INSERT INTO published_sites", [publishedSiteRow()]],
    ]);
    const pool = createFakePool(client);
    const store = createPostgresPublishStore("postgres://test", { getPool: () => pool });

    const result = await store.publishWithChallenge(publishInput(), alwaysValidSignature);

    expect(result.status).toBe("published");
    if (result.status === "published") {
      expect(result.site.slug).toBe(SLUG);
      expect(result.ownerWalletAddress).toBe(WALLET);
    }
  });

  it("maps an empty RETURNING (owner mismatch) to slug_conflict", async () => {
    const client = createFakeClient([
      ["FROM wallet_nonces", [nonceRow()]],
      ["INSERT INTO published_sites", []],
    ]);
    const pool = createFakePool(client);
    const store = createPostgresPublishStore("postgres://test", { getPool: () => pool });

    const result = await store.publishWithChallenge(publishInput(), alwaysValidSignature);

    expect(result).toEqual({ status: "slug_conflict" });
  });

  it("issues the wallet_nonces used_at UPDATE exactly once per call", async () => {
    const client = createFakeClient([
      ["FROM wallet_nonces", [nonceRow()]],
      ["INSERT INTO published_sites", [publishedSiteRow()]],
    ]);
    const pool = createFakePool(client);
    const store = createPostgresPublishStore("postgres://test", { getPool: () => pool });

    await store.publishWithChallenge(publishInput(), alwaysValidSignature);

    const usedAtUpdates = client.calls.filter((call) =>
      call.text.startsWith("UPDATE wallet_nonces SET used_at"),
    );
    expect(usedAtUpdates).toHaveLength(1);
  });
});
