from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace(path: str, old: str, new: str) -> None:
    content = read(path)
    if old not in content:
        raise SystemExit(f"Expected block not found in {path}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


write("db/migrations/002_draft_visibility.sql", r'''-- Apply deliberately after owner review; existing public rows remain live while new publishes start as drafts.
BEGIN;

ALTER TABLE published_sites
  ADD COLUMN IF NOT EXISTS visibility TEXT;

ALTER TABLE published_sites
  ADD COLUMN IF NOT EXISTS draft_token TEXT;

UPDATE published_sites
   SET visibility = 'live'
 WHERE visibility IS NULL;

ALTER TABLE published_sites
  ALTER COLUMN visibility SET DEFAULT 'draft';

ALTER TABLE published_sites
  ALTER COLUMN visibility SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'published_sites_visibility_check'
  ) THEN
    ALTER TABLE published_sites
      ADD CONSTRAINT published_sites_visibility_check
      CHECK (visibility IN ('draft', 'live'));
  END IF;
END;
$$;

COMMIT;
''')

replace(
    "lib/public-site.ts",
    'import type { ProjectStatus, SupportedChain, TokenProject } from "@/lib/types";\n',
    'import type { ProjectStatus, SupportedChain, TokenProject } from "@/lib/types";\n\nexport type PublishedSiteVisibility = "draft" | "live";\n',
)
replace(
    "lib/public-site.ts",
    '  status: ProjectStatus;\n  createdAt: string;\n',
    '  status: ProjectStatus;\n  /** Durable publish visibility. Missing legacy/test values are treated as live. */\n  visibility?: PublishedSiteVisibility;\n  /** Server-generated secret used only to authorise a draft preview URL. */\n  draftToken?: string | null;\n  createdAt: string;\n',
)

replace(
    "lib/server/publish-auth.ts",
    'export function createPublishNonce(): string {\n  return randomBytes(24).toString("base64url");\n}\n',
    'export function createPublishNonce(): string {\n  return randomBytes(24).toString("base64url");\n}\n\nexport function createDraftToken(): string {\n  return randomBytes(32).toString("base64url");\n}\n',
)

write("lib/server/publish-store.ts", r'''import type { PublicGeneratedSite, PublishedSiteVisibility } from "@/lib/public-site";
import type { PublishChallenge } from "@/lib/server/publish-auth";
import type { PublishableSite } from "@/lib/server/published-site-validation";
import { createPostgresPublishStore } from "@/lib/server/postgres-publish-store";

export type CreatePublishChallengeInput = {
  nonceHash: string;
  walletAddress: string;
  slug: string;
  walletChainId: number;
  sitePayloadHash: string;
  issuedAt: Date;
  expiresAt: Date;
};

export type PublishWithChallengeInput = {
  challengeId: string;
  nonceHash: string;
  sitePayloadHash: string;
  site: PublishableSite;
};

export type SetVisibilityWithChallengeInput = {
  challengeId: string;
  nonceHash: string;
  slug: string;
  visibility: Extract<PublishedSiteVisibility, "live">;
};

export type PublishStoreResult =
  | { status: "published"; site: PublicGeneratedSite; ownerWalletAddress: string }
  | { status: "nonce_not_found" }
  | { status: "nonce_expired" }
  | { status: "nonce_replayed" }
  | { status: "nonce_mismatch" }
  | { status: "invalid_signature" }
  | { status: "slug_conflict" };

export type PublishVisibilityResult =
  | { status: "updated"; site: PublicGeneratedSite; ownerWalletAddress: string }
  | { status: "nonce_not_found" }
  | { status: "nonce_expired" }
  | { status: "nonce_replayed" }
  | { status: "nonce_mismatch" }
  | { status: "invalid_signature" }
  | { status: "site_not_found" }
  | { status: "not_owner" };

export type PublishSignatureVerifier = (challenge: PublishChallenge) => Promise<boolean>;

export interface PublishStore {
  createChallenge(input: CreatePublishChallengeInput): Promise<PublishChallenge>;
  publishWithChallenge(
    input: PublishWithChallengeInput,
    verifySignature: PublishSignatureVerifier,
  ): Promise<PublishStoreResult>;
  setVisibilityWithChallenge?(
    input: SetVisibilityWithChallengeInput,
    verifySignature: PublishSignatureVerifier,
  ): Promise<PublishVisibilityResult>;
  getBySlug(slug: string): Promise<PublicGeneratedSite | null>;
}

export class PublishStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for durable publishing.");
    this.name = "PublishStoreUnavailableError";
  }
}

const unconfiguredStore: PublishStore = {
  async createChallenge() {
    throw new PublishStoreUnavailableError();
  },
  async publishWithChallenge() {
    throw new PublishStoreUnavailableError();
  },
  async setVisibilityWithChallenge() {
    throw new PublishStoreUnavailableError();
  },
  async getBySlug() {
    return null;
  },
};

let testStore: PublishStore | null = null;
let productionStore: PublishStore | null = null;
let productionDatabaseUrl = "";

export function setPublishStoreForTests(store: PublishStore): void {
  testStore = store;
}

export function resetPublishStoreForTests(): void {
  testStore = null;
}

export function getPublishStore(): PublishStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresPublishStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}
''')

write("lib/server/postgres-publish-store.ts", r'''import type { PoolClient } from "pg";
import type { PublicGeneratedSite, PublishedSiteVisibility } from "@/lib/public-site";
import { getPostgresPool } from "@/lib/server/postgres";
import { createDraftToken, type PublishChallenge } from "@/lib/server/publish-auth";
import {
  sanitisePublishedGeneratedHtml,
  type PublishableSite,
} from "@/lib/server/published-site-validation";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";
import type {
  CreatePublishChallengeInput,
  PublishSignatureVerifier,
  PublishStore,
  PublishStoreResult,
  PublishVisibilityResult,
  PublishWithChallengeInput,
  SetVisibilityWithChallengeInput,
} from "@/lib/server/publish-store";
import type { ProjectStatus, SupportedChain } from "@/lib/types";

type NonceRow = {
  id: string;
  nonce_hash: string;
  wallet_address: string;
  slug: string;
  wallet_chain_id: string | number;
  site_payload_hash: string;
  issued_at: Date | string;
  expires_at: Date | string;
  used_at: Date | string | null;
};

type PublishedSiteRow = {
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
  created_at: Date | string;
  updated_at: Date | string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function challengeFromRow(row: NonceRow): PublishChallenge {
  return {
    id: row.id,
    nonceHash: row.nonce_hash,
    walletAddress: row.wallet_address,
    slug: row.slug,
    walletChainId: Number(row.wallet_chain_id),
    sitePayloadHash: row.site_payload_hash,
    issuedAt: asDate(row.issued_at),
    expiresAt: asDate(row.expires_at),
    usedAt: row.used_at ? asDate(row.used_at) : null,
  };
}

function isSupportedChain(value: string): value is SupportedChain {
  return value === "robinhood" || value === "solana";
}

function isProjectStatus(value: string): value is ProjectStatus {
  return value === "draft" || value === "prepared" || value === "launched";
}

function isPublishedSiteVisibility(value: string): value is PublishedSiteVisibility {
  return value === "draft" || value === "live";
}

function siteFromRow(row: PublishedSiteRow): PublicGeneratedSite | null {
  if (
    !isSupportedChain(row.chain) ||
    !isProjectStatus(row.status) ||
    !isPublishedSiteVisibility(row.visibility)
  ) return null;
  const generatedSiteHtml = sanitisePublishedGeneratedHtml(row.generated_html);
  const heroImage = decodeArtworkDataUrl(row.artwork_reference) ? row.artwork_reference : "";

  return {
    slug: row.slug,
    name: row.token_name,
    ticker: row.ticker,
    description: row.description,
    supply: row.supply,
    decimals: Number(row.decimals),
    chain: row.chain,
    heroImage,
    generatedSiteHtml,
    contractAddress: row.contract_address,
    xHandle: row.x_handle,
    telegram: row.telegram,
    status: row.status,
    visibility: row.visibility,
    draftToken: row.draft_token,
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
  };
}

const NONCE_COLUMNS = `
  id, nonce_hash, wallet_address, slug, wallet_chain_id,
  site_payload_hash, issued_at, expires_at, used_at
`;

const SITE_COLUMNS = `
  slug, token_name, ticker, description, supply, decimals, chain, chain_id,
  contract_address, generated_html, artwork_reference, owner_wallet_address,
  x_handle, telegram, status, visibility, draft_token, created_at, updated_at
`;

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

async function insertPublishedSite(
  client: PoolClient,
  site: PublishableSite,
  ownerWalletAddress: string,
): Promise<PublishedSiteRow | null> {
  const result = await client.query<PublishedSiteRow>(
    `INSERT INTO published_sites (
      slug, token_name, ticker, description, supply, decimals, chain, chain_id,
      contract_address, generated_html, artwork_reference, owner_wallet_address,
      x_handle, telegram, status, visibility, draft_token
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, $16, $17
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING ${SITE_COLUMNS}`,
    [
      site.slug,
      site.name,
      site.ticker,
      site.description,
      site.supply,
      site.decimals,
      site.chain,
      site.chainId,
      site.contractAddress,
      site.generatedSiteHtml,
      site.artworkReference,
      ownerWalletAddress,
      site.xHandle,
      site.telegram,
      site.status,
      "draft",
      createDraftToken(),
    ],
  );
  return result.rows[0] || null;
}

function challengeFailure(
  challenge: PublishChallenge,
  input: { nonceHash: string; slug: string },
): PublishVisibilityResult | null {
  if (challenge.usedAt) return { status: "nonce_replayed" };
  if (challenge.expiresAt.getTime() <= Date.now()) return { status: "nonce_expired" };
  if (challenge.nonceHash !== input.nonceHash || challenge.slug !== input.slug) {
    return { status: "nonce_mismatch" };
  }
  return null;
}

export function createPostgresPublishStore(databaseUrl: string): PublishStore {
  const pool = getPostgresPool(databaseUrl);

  return {
    async createChallenge(input: CreatePublishChallengeInput): Promise<PublishChallenge> {
      const result = await pool.query<NonceRow>(
        `INSERT INTO wallet_nonces (
          nonce_hash, wallet_address, slug, wallet_chain_id, site_payload_hash,
          issued_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING ${NONCE_COLUMNS}`,
        [
          input.nonceHash,
          input.walletAddress,
          input.slug,
          input.walletChainId,
          input.sitePayloadHash,
          input.issuedAt,
          input.expiresAt,
        ],
      );
      return challengeFromRow(result.rows[0]);
    },

    async publishWithChallenge(
      input: PublishWithChallengeInput,
      verifySignature: PublishSignatureVerifier,
    ): Promise<PublishStoreResult> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const nonceResult = await client.query<NonceRow>(
          `SELECT ${NONCE_COLUMNS}
             FROM wallet_nonces
            WHERE id = $1
            FOR UPDATE`,
          [input.challengeId],
        );
        const row = nonceResult.rows[0];
        if (!row) {
          await rollback(client);
          return { status: "nonce_not_found" };
        }

        const challenge = challengeFromRow(row);
        if (challenge.usedAt) {
          await rollback(client);
          return { status: "nonce_replayed" };
        }
        if (challenge.expiresAt.getTime() <= Date.now()) {
          await rollback(client);
          return { status: "nonce_expired" };
        }
        if (
          challenge.nonceHash !== input.nonceHash ||
          challenge.slug !== input.site.slug ||
          challenge.sitePayloadHash !== input.sitePayloadHash
        ) {
          await rollback(client);
          return { status: "nonce_mismatch" };
        }
        if (!(await verifySignature(challenge))) {
          await rollback(client);
          return { status: "invalid_signature" };
        }

        await client.query("UPDATE wallet_nonces SET used_at = NOW() WHERE id = $1", [challenge.id]);
        const inserted = await insertPublishedSite(client, input.site, challenge.walletAddress);
        await client.query("COMMIT");

        if (!inserted) return { status: "slug_conflict" };
        const site = siteFromRow(inserted);
        if (!site) throw new Error("The inserted public site could not be mapped safely.");
        return {
          status: "published",
          site,
          ownerWalletAddress: challenge.walletAddress,
        };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async setVisibilityWithChallenge(
      input: SetVisibilityWithChallengeInput,
      verifySignature: PublishSignatureVerifier,
    ): Promise<PublishVisibilityResult> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const nonceResult = await client.query<NonceRow>(
          `SELECT ${NONCE_COLUMNS}
             FROM wallet_nonces
            WHERE id = $1
            FOR UPDATE`,
          [input.challengeId],
        );
        const nonceRow = nonceResult.rows[0];
        if (!nonceRow) {
          await rollback(client);
          return { status: "nonce_not_found" };
        }

        const challenge = challengeFromRow(nonceRow);
        const challengeError = challengeFailure(challenge, input);
        if (challengeError) {
          await rollback(client);
          return challengeError;
        }
        if (!(await verifySignature(challenge))) {
          await rollback(client);
          return { status: "invalid_signature" };
        }

        const siteResult = await client.query<PublishedSiteRow>(
          `SELECT ${SITE_COLUMNS}
             FROM published_sites
            WHERE slug = $1
            FOR UPDATE`,
          [input.slug],
        );
        const siteRow = siteResult.rows[0];
        if (!siteRow) {
          await rollback(client);
          return { status: "site_not_found" };
        }
        if (siteRow.owner_wallet_address.toLowerCase() !== challenge.walletAddress.toLowerCase()) {
          await rollback(client);
          return { status: "not_owner" };
        }

        await client.query("UPDATE wallet_nonces SET used_at = NOW() WHERE id = $1", [challenge.id]);
        const updated = await client.query<PublishedSiteRow>(
          `UPDATE published_sites
              SET visibility = $2,
                  draft_token = CASE WHEN $2 = 'live' THEN NULL ELSE draft_token END
            WHERE slug = $1
            RETURNING ${SITE_COLUMNS}`,
          [input.slug, input.visibility],
        );
        await client.query("COMMIT");

        const site = updated.rows[0] ? siteFromRow(updated.rows[0]) : null;
        if (!site) throw new Error("The updated public site could not be mapped safely.");
        return { status: "updated", site, ownerWalletAddress: challenge.walletAddress };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async getBySlug(slug: string): Promise<PublicGeneratedSite | null> {
      const result = await pool.query<PublishedSiteRow>(
        `SELECT ${SITE_COLUMNS}
           FROM published_sites
          WHERE slug = $1
          LIMIT 1`,
        [slug],
      );
      return result.rows[0] ? siteFromRow(result.rows[0]) : null;
    },
  };
}
''')

replace(
    "app/api/publish/route.ts",
    '    const publicUrl = `https://hoodlums.dev/${result.site.slug}`;\n    return NextResponse.json(\n      {\n        published: true,\n        slug: result.site.slug,\n        publicUrl,\n        ownerWalletAddress: result.ownerWalletAddress,\n      },\n',
    '    const publicUrl = `https://hoodlums.dev/${result.site.slug}`;\n    const draftPreviewUrl = result.site.draftToken\n      ? `${publicUrl}?preview=${encodeURIComponent(result.site.draftToken)}`\n      : null;\n    return NextResponse.json(\n      {\n        published: true,\n        visibility: result.site.visibility || "draft",\n        slug: result.site.slug,\n        publicUrl,\n        draftPreviewUrl,\n        ownerWalletAddress: result.ownerWalletAddress,\n      },\n',
)

write("app/api/publish/visibility/route.ts", r'''import { NextResponse } from "next/server";
import {
  PUBLISH_SITE_LIMIT,
  consumePublishSiteRateLimit,
  getClientIp,
} from "@/lib/server/api-protection";
import { hashPublishNonce, verifyPublishSignature } from "@/lib/server/publish-auth";
import {
  getPublishStore,
  PublishStoreUnavailableError,
  type PublishVisibilityResult,
} from "@/lib/server/publish-store";
import { validateSlug } from "@/lib/slug";

export const runtime = "nodejs";

function allowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

function responseHeaders(rate: ReturnType<typeof consumePublishSiteRateLimit>) {
  return {
    "Cache-Control": "no-store",
    "X-RateLimit-Limit": String(PUBLISH_SITE_LIMIT),
    "X-RateLimit-Remaining": String(rate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
  };
}

function failureResponse(
  result: Exclude<PublishVisibilityResult, { status: "updated" }>,
  headers: Record<string, string>,
) {
  if (result.status === "not_owner") {
    return NextResponse.json(
      { error: "The connected wallet is not the owner of this published site." },
      { status: 403, headers },
    );
  }
  if (result.status === "site_not_found") {
    return NextResponse.json({ error: "The published site was not found." }, { status: 404, headers });
  }
  if (result.status === "nonce_expired") {
    return NextResponse.json(
      { error: "The wallet signature challenge expired. Request a new challenge." },
      { status: 410, headers },
    );
  }
  if (result.status === "nonce_replayed") {
    return NextResponse.json(
      { error: "That wallet signature challenge has already been used." },
      { status: 409, headers },
    );
  }
  return NextResponse.json(
    { error: "Wallet visibility authorisation failed." },
    { status: 401, headers },
  );
}

export async function POST(request: Request) {
  if (!allowedOrigin(request)) {
    return NextResponse.json(
      { error: "Publish visibility origin is not allowed." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rate = consumePublishSiteRateLimit(getClientIp(request));
  const headers = responseHeaders(rate);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many publish requests. Try again later." },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : "";
  const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9_-]{20,128}$/.test(nonce)) {
    return NextResponse.json({ error: "A valid publish challenge is required." }, { status: 400, headers });
  }
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) {
    return NextResponse.json(
      { error: "A valid wallet message signature is required." },
      { status: 400, headers },
    );
  }
  if (body?.walletAddress !== undefined) {
    return NextResponse.json(
      { error: "Do not submit an owner wallet address; ownership comes from the verified challenge." },
      { status: 400, headers },
    );
  }
  const slugValidation = validateSlug(slug);
  if (!slugValidation.valid) {
    return NextResponse.json({ error: slugValidation.reason }, { status: 400, headers });
  }

  try {
    const store = getPublishStore();
    if (!store.setVisibilityWithChallenge) {
      throw new PublishStoreUnavailableError();
    }
    const result = await store.setVisibilityWithChallenge(
      {
        challengeId,
        nonceHash: hashPublishNonce(nonce),
        slug,
        visibility: "live",
      },
      (challenge) => verifyPublishSignature(challenge, nonce, signature),
    );

    if (result.status !== "updated") return failureResponse(result, headers);
    return NextResponse.json(
      {
        live: true,
        visibility: "live",
        slug: result.site.slug,
        publicUrl: `https://hoodlums.dev/${result.site.slug}`,
      },
      { status: 200, headers },
    );
  } catch (error) {
    const unavailable = error instanceof PublishStoreUnavailableError;
    return NextResponse.json(
      {
        error: unavailable
          ? "Public publishing is not configured on this deployment."
          : "The site visibility could not be changed.",
      },
      { status: unavailable ? 503 : 500, headers },
    );
  }
}
''')

write("app/[slug]/page.tsx", r'''import { timingSafeEqual } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDexscreenerSection } from "@/components/public-dexscreener-section";
import { PublicSiteFrame } from "@/components/public-site-frame";
import { PublicTokenFallback } from "@/components/public-token-fallback";
import { isCompleteGeneratedPageHtml, prepareGeneratedPageForPreview } from "@/lib/generated-site-page";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { getPublicGeneratedSiteBySlug } from "@/lib/server/public-generated-sites";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";
import { validateSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DRAFT_ROBOTS = { index: false, follow: false } as const;

type PublicSiteRouteParams = { slug: string };
type PublicSiteSearchParams = { preview?: string | string[] };
type PublicSiteRouteProps = {
  params: Promise<PublicSiteRouteParams>;
  searchParams?: Promise<PublicSiteSearchParams>;
};

async function previewToken(searchParams?: Promise<PublicSiteSearchParams>): Promise<string> {
  const value = searchParams ? (await searchParams).preview : undefined;
  return typeof value === "string" ? value : "";
}

function draftTokenMatches(site: PublicGeneratedSite, supplied: string): boolean {
  if (site.visibility !== "draft" || !site.draftToken || !supplied) return false;
  const expected = Buffer.from(site.draftToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function canRenderSite(site: PublicGeneratedSite, suppliedPreviewToken: string): boolean {
  return site.visibility !== "draft" || draftTokenMatches(site, suppliedPreviewToken);
}

export async function generateMetadata({ params, searchParams }: PublicSiteRouteProps): Promise<Metadata> {
  const { slug } = await params;
  if (!validateSlug(slug).valid) return {};

  const site = await getPublicGeneratedSiteBySlug(slug);
  if (!site) return {};

  const isDraft = site.visibility === "draft";
  const suppliedPreviewToken = await previewToken(searchParams);
  if (isDraft && !draftTokenMatches(site, suppliedPreviewToken)) {
    return { robots: DRAFT_ROBOTS };
  }

  const title = `${site.name} ($${site.ticker})`;
  const canonical = `https://hoodlums.dev/${slug}`;
  const hasArtwork = !isDraft && Boolean(decodeArtworkDataUrl(site.heroImage));
  const images = hasArtwork ? [`/${slug}/artwork`] : undefined;

  return {
    title,
    description: site.description,
    alternates: { canonical },
    robots: isDraft ? DRAFT_ROBOTS : undefined,
    openGraph: {
      type: "website",
      url: canonical,
      title,
      description: site.description,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description: site.description,
      images,
    },
  };
}

export default async function PublicGeneratedSitePage({ params, searchParams }: PublicSiteRouteProps) {
  const { slug } = await params;
  if (!validateSlug(slug).valid) notFound();

  const site = await getPublicGeneratedSiteBySlug(slug);
  if (!site) notFound();
  if (!canRenderSite(site, await previewToken(searchParams))) notFound();

  const hasGeneratedHtml = isCompleteGeneratedPageHtml(site.generatedSiteHtml);
  const hasArtwork = Boolean(decodeArtworkDataUrl(site.heroImage));

  return (
    <main className="public-generated-site">
      {hasGeneratedHtml && hasArtwork ? (
        <PublicSiteFrame html={prepareGeneratedPageForPreview(site.generatedSiteHtml as string, site.heroImage)} />
      ) : (
        <PublicTokenFallback site={site} />
      )}
      {site.contractAddress ? <PublicDexscreenerSection address={site.contractAddress} /> : null}
    </main>
  );
}
''')

replace(
    "components/build-site-gate.tsx",
    '''type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
};''',
    '''type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
  slug: string;
  supply: string;
  decimals: number;
  chain: "robinhood" | "solana";
  chainId: string;
  contractAddress: string;
  xHandle: string;
  telegram: string;
};''',
)
replace(
    "components/build-site-gate.tsx",
    '''    function currentDetail(panel: Element): GenerateDetail {
      return {
        name: findControl(panel, "Token name")?.value.trim() || "",
        ticker: findControl(panel, "Ticker")?.value.trim() || "",
        description: findControl(panel, "Project story")?.value.trim() || "",
        imageDataUrl: panel.querySelector<HTMLImageElement>(".upload-box img")?.src,
        inspirationUrl:
          panel.querySelector<HTMLInputElement>(".build-site-inspiration-url")?.value.trim() || "",
      };
    }''',
    '''    function currentDetail(panel: Element): GenerateDetail {
      const chain = panel.querySelector(".chain-option.active .chain-dot.solana")
        ? "solana"
        : "robinhood";
      return {
        name: findControl(panel, "Token name")?.value.trim() || "",
        ticker: findControl(panel, "Ticker")?.value.trim() || "",
        description: findControl(panel, "Project story")?.value.trim() || "",
        imageDataUrl: panel.querySelector<HTMLImageElement>(".upload-box img")?.src,
        inspirationUrl:
          panel.querySelector<HTMLInputElement>(".build-site-inspiration-url")?.value.trim() || "",
        slug: findControl(panel, "Website path")?.value.trim() || "",
        supply: findControl(panel, "Total supply")?.value.trim() || "",
        decimals: Number(findControl(panel, "Decimals")?.value || 0),
        chain,
        chainId: chain === "robinhood" ? "46630" : "solana-devnet",
        contractAddress: findControl(panel, "Contract / mint address")?.value.trim() || "",
        xHandle: findControl(panel, "X handle")?.value.trim() || "",
        telegram: findControl(panel, "Telegram")?.value.trim() || "",
      };
    }''',
)

# Full website generator: add wallet/publish helpers while retaining the one-iframe imperative architecture.
replace(
    "components/full-website-generator.tsx",
    'import { useEffect } from "react";\n',
    'import { useEffect } from "react";\nimport { createWalletClient, custom } from "viem";\n',
)
replace(
    "components/full-website-generator.tsx",
    '} from "@/lib/generate-site-page-stream-protocol";\n',
    '} from "@/lib/generate-site-page-stream-protocol";\nimport { getInjectedEvmProvider } from "@/lib/wallet-provider";\n',
)
replace(
    "components/full-website-generator.tsx",
    '''type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
};''',
    '''type GenerateDetail = {
  name: string;
  ticker: string;
  description: string;
  imageDataUrl?: string;
  inspirationUrl?: string;
  slug?: string;
  supply?: string;
  decimals?: number;
  chain?: "robinhood" | "solana";
  chainId?: string;
  contractAddress?: string;
  xHandle?: string;
  telegram?: string;
};

type PublishableSitePayload = {
  slug: string;
  name: string;
  ticker: string;
  description: string;
  supply: string;
  decimals: number;
  chain: "robinhood" | "solana";
  chainId: string;
  contractAddress: string;
  generatedSiteHtml: string;
  artworkReference: string;
  xHandle: string;
  telegram: string;
  status: "prepared";
};

type PublishChallengeResponse = {
  challengeId: string;
  nonce: string;
  message: string;
};

type DraftPublishResponse = {
  slug: string;
  draftPreviewUrl: string | null;
};

type GoLiveResponse = {
  slug: string;
  publicUrl: string;
};''',
)
replace(
    "components/full-website-generator.tsx",
    '''type RenderedPreview = {
  container: HTMLElement;
  frame: HTMLIFrameElement;
  closeButton: HTMLButtonElement;
  fullScreenButton: HTMLButtonElement;
  onClose: () => void;
  onToggleFullScreen: () => void;
};''',
    '''type RenderedPreview = {
  container: HTMLElement;
  frame: HTMLIFrameElement;
  controlCleanups: Array<() => void>;
};''',
)

insert_before_request = r'''
function publishableSiteFromGeneration(detail: GenerateDetail, html: string): PublishableSitePayload {
  return {
    slug: detail.slug?.trim() || "",
    name: detail.name.trim(),
    ticker: detail.ticker.trim().toUpperCase(),
    description: detail.description.trim(),
    supply: detail.supply?.trim() || "",
    decimals: Number(detail.decimals ?? 0),
    chain: detail.chain || "robinhood",
    chainId: detail.chainId || "46630",
    contractAddress: detail.contractAddress?.trim() || "",
    generatedSiteHtml: html,
    artworkReference: detail.imageDataUrl || "",
    xHandle: detail.xHandle?.trim() || "",
    telegram: detail.telegram?.trim() || "",
    status: "prepared",
  };
}

async function readApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & Partial<T>;
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload as T;
}

async function requestPublishAuthorisation(site: PublishableSitePayload) {
  if (site.chain !== "robinhood") {
    throw new Error("Draft publishing currently requires a Robinhood Chain EVM project.");
  }
  const provider = getInjectedEvmProvider();
  if (!provider) throw new Error("Connect an EVM wallet before publishing.");

  const walletClient = createWalletClient({ transport: custom(provider) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("The wallet returned no account.");
  const walletChainId = await walletClient.getChainId();
  if (String(walletChainId) !== site.chainId) {
    throw new Error(`Switch the wallet to chain ${site.chainId} before publishing.`);
  }

  const challengeResponse = await fetch("/api/publish/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: account, walletChainId, site }),
  });
  const challenge = await readApiResponse<PublishChallengeResponse>(
    challengeResponse,
    "The publish challenge could not be created.",
  );
  const signature = await walletClient.signMessage({ account, message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}

async function publishDraft(site: PublishableSitePayload): Promise<DraftPublishResponse> {
  const { challengeId, nonce, signature } = await requestPublishAuthorisation(site);
  const response = await fetch("/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, nonce, signature, site }),
  });
  const result = await readApiResponse<DraftPublishResponse>(response, "The draft could not be published.");
  if (!result.draftPreviewUrl) throw new Error("The server did not return a draft preview URL.");
  return result;
}

async function makePublishedSiteLive(site: PublishableSitePayload): Promise<GoLiveResponse> {
  const { challengeId, nonce, signature } = await requestPublishAuthorisation(site);
  const response = await fetch("/api/publish/visibility", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, nonce, signature, slug: site.slug }),
  });
  return readApiResponse<GoLiveResponse>(response, "The site could not be made live.");
}
'''
replace(
    "components/full-website-generator.tsx",
    'export async function requestGeneratedWebsite(\n',
    insert_before_request + '\nexport async function requestGeneratedWebsite(\n',
)

replace(
    "components/full-website-generator.tsx",
    '''function disposeRenderedPreview(preview: RenderedPreview | null) {
  if (!preview) return;
  preview.closeButton.removeEventListener("click", preview.onClose);
  preview.fullScreenButton.removeEventListener("click", preview.onToggleFullScreen);
  preview.container.classList.remove("full-generated-page-fullscreen");
  disposeFrame(preview.frame);
  preview.container.remove();
}''',
    '''function disposeRenderedPreview(preview: RenderedPreview | null) {
  if (!preview) return;
  for (const cleanup of preview.controlCleanups) cleanup();
  preview.container.classList.remove("full-generated-page-fullscreen");
  disposeFrame(preview.frame);
  preview.container.remove();
}''',
)

content = read("components/full-website-generator.tsx")
pattern = re.compile(r'function renderGeneratedWebsite\([\s\S]*?\n}\n\n\nexport function FullWebsiteGenerator\(\)', re.M)
replacement = r'''function renderGeneratedWebsite(
  html: string,
  artworkDataUrl: string,
  publishSite: PublishableSitePayload,
  onClosePreview: () => void,
): RenderedPreview {
  const site = previewElement();
  const prepared = prepareGeneratedPageForPreview(html, artworkDataUrl);
  clearPreviewStatus(site);

  const container = document.createElement("section");
  container.className = "full-generated-page-container";
  container.setAttribute("aria-label", "Generated website preview");

  const controls = document.createElement("div");
  controls.className = "full-generated-page-controls";
  const controlCleanups: Array<() => void> = [];

  const publishStatus = document.createElement("span");
  publishStatus.className = "full-generated-page-publish-status";
  publishStatus.setAttribute("aria-live", "polite");

  const publishButton = document.createElement("button");
  publishButton.type = "button";
  publishButton.className = "full-generated-page-publish-button";
  publishButton.textContent = "Publish draft";

  const fullScreenButton = document.createElement("button");
  fullScreenButton.type = "button";
  fullScreenButton.className = "full-generated-page-fullscreen-button";
  fullScreenButton.textContent = "Full screen";
  fullScreenButton.setAttribute("aria-pressed", "false");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "full-generated-page-close-button";
  closeButton.textContent = "Close preview";

  const viewport = document.createElement("div");
  viewport.className = "full-generated-page-viewport";

  const frame = document.createElement("iframe");
  frame.className = "full-generated-page-frame";
  frame.title = "Generated token landing page";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("loading", "eager");
  frame.setAttribute("scrolling", "yes");
  applyGeneratedPreviewHeight(frame, 1800);
  frame.srcdoc = prepared;

  const listen = (button: HTMLButtonElement, listener: () => void) => {
    button.addEventListener("click", listener);
    controlCleanups.push(() => button.removeEventListener("click", listener));
  };

  const onToggleFullScreen = () => {
    const fullScreen = container.classList.toggle("full-generated-page-fullscreen");
    fullScreenButton.textContent = fullScreen ? "Exit full screen" : "Full screen";
    fullScreenButton.setAttribute("aria-pressed", String(fullScreen));
  };
  const onClose = () => onClosePreview();

  const onPublishDraft = async () => {
    publishButton.disabled = true;
    publishStatus.textContent = "Requesting wallet signature…";
    try {
      const draft = await publishDraft(publishSite);
      let destinationUrl = draft.draftPreviewUrl as string;
      publishButton.remove();

      const viewDraftButton = document.createElement("button");
      viewDraftButton.type = "button";
      viewDraftButton.className = "full-generated-page-view-button";
      viewDraftButton.textContent = "View draft";

      const goLiveButton = document.createElement("button");
      goLiveButton.type = "button";
      goLiveButton.className = "full-generated-page-live-button";
      goLiveButton.textContent = "Go live";

      const onViewDraft = () => {
        window.open(destinationUrl, "_blank", "noopener,noreferrer");
      };
      const onGoLive = async () => {
        goLiveButton.disabled = true;
        publishStatus.textContent = "Requesting owner signature…";
        try {
          const live = await makePublishedSiteLive(publishSite);
          destinationUrl = live.publicUrl;
          viewDraftButton.textContent = "View live";
          goLiveButton.textContent = "Live";
          publishStatus.textContent = "Site is live.";
        } catch (error) {
          goLiveButton.disabled = false;
          publishStatus.textContent = error instanceof Error ? error.message : "The site could not be made live.";
        }
      };

      listen(viewDraftButton, onViewDraft);
      listen(goLiveButton, () => { void onGoLive(); });
      controls.insertBefore(viewDraftButton, fullScreenButton);
      controls.insertBefore(goLiveButton, fullScreenButton);
      publishStatus.textContent = "Draft published. Review it before going live.";
    } catch (error) {
      publishButton.disabled = false;
      publishStatus.textContent = error instanceof Error ? error.message : "The draft could not be published.";
    }
  };

  listen(publishButton, () => { void onPublishDraft(); });
  listen(fullScreenButton, onToggleFullScreen);
  listen(closeButton, onClose);
  controls.append(publishStatus, publishButton, fullScreenButton, closeButton);
  viewport.appendChild(frame);
  container.append(controls, viewport);

  site.classList.add("full-generated-page");
  site.appendChild(container);

  return { container, frame, controlCleanups };
}

export function FullWebsiteGenerator()'''
if not pattern.search(content):
    raise SystemExit("renderGeneratedWebsite block not found")
write("components/full-website-generator.tsx", pattern.sub(replacement, content, count=1))

replace(
    "components/full-website-generator.tsx",
    '''        activePreview = renderGeneratedWebsite(page.html, detail.imageDataUrl || "", () => {
          generationNumber += 1;
          activeController?.abort();
          activeController = null;
          restoreStudioControls();
        });''',
    '''        const publishSite = publishableSiteFromGeneration(detail, page.html);
        activePreview = renderGeneratedWebsite(page.html, detail.imageDataUrl || "", publishSite, () => {
          generationNumber += 1;
          activeController?.abort();
          activeController = null;
          restoreStudioControls();
        });''',
)
replace(
    "components/full-website-generator.tsx",
    '''      .full-generated-page-controls button:focus-visible {
        outline: 3px solid rgba(49, 95, 123, .28);
        outline-offset: 2px;
      }
      .full-generated-page-close-button {''',
    '''      .full-generated-page-controls button:focus-visible {
        outline: 3px solid rgba(49, 95, 123, .28);
        outline-offset: 2px;
      }
      .full-generated-page-controls button:disabled { opacity: .55; cursor: wait; }
      .full-generated-page-publish-status {
        min-width: 0;
        margin-right: auto;
        color: #526878;
        font: 700 11px/1.35 system-ui, sans-serif;
      }
      .full-generated-page-publish-status:empty { display: none; }
      .full-generated-page-publish-button,
      .full-generated-page-live-button {
        background: #315f7b !important;
        color: #fff !important;
      }
      .full-generated-page-close-button {''',
)
replace(
    "components/full-website-generator.tsx",
    '''        .full-generated-page-controls {
          justify-content: stretch;
          padding: 8px;
        }
        .full-generated-page-controls button { flex: 1 1 0; }''',
    '''        .full-generated-page-controls {
          flex-wrap: wrap;
          justify-content: stretch;
          padding: 8px;
        }
        .full-generated-page-publish-status { flex: 1 0 100%; }
        .full-generated-page-controls button { flex: 1 1 120px; }''',
)

replace(
    "tests/backend-inventory.test.ts",
    '      "app/api/publish/route.ts",\n',
    '      "app/api/publish/route.ts",\n      "app/api/publish/visibility/route.ts",\n',
)
replace(
    "tests/backend-inventory.test.ts",
    '      "app/api/publish/route.ts": ["POST"],\n',
    '      "app/api/publish/route.ts": ["POST"],\n      "app/api/publish/visibility/route.ts": ["POST"],\n',
)

write("tests/draft-publishing.test.ts", r'''import { randomUUID } from "node:crypto";
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
  type PublishWithChallengeInput,
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
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Draft</title><style>body{margin:0}</style></head><body><section id="hero"><img src="${ARTWORK_PLACEHOLDER}"></section><section id="about">${copy}</section><section id="tokenomics">Supply</section><section id="roadmap">Roadmap</section><section id="how-to-buy">Buy</section><section id="community">Community</section><script>1;</script></body></html>`;
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

  async publishWithChallenge(
    _input: PublishWithChallengeInput,
    _verifySignature: PublishSignatureVerifier,
  ): Promise<PublishStoreResult> {
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
    expect(generator).toContain('viewDraftButton.addEventListener("click"');
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
''')

print("Draft publishing implementation applied.")
