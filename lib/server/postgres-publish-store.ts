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
  UpdateContractAddressInput,
  UpdateContractAddressResult,
} from "@/lib/server/publish-store";
import type { ProjectStatus, SupportedChain } from "@/lib/types";

type QueryResult<T> = { rows: T[] };

type PoolClientLike = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
};

export type PostgresPoolLike = {
  connect(): Promise<PoolClientLike>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

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
  lp_locked_at: Date | string | null;
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
    lpLockedAt: row.lp_locked_at ? asDate(row.lp_locked_at).toISOString() : null,
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
  x_handle, telegram, status, visibility, draft_token, lp_locked_at,
  created_at, updated_at
`;

async function rollback(client: PoolClientLike): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original database error.
  }
}

/**
 * Inserts a new published site, or — when the slug already exists and the
 * publishing wallet is the row's existing owner — republishes over it. The
 * `ON CONFLICT ... WHERE` predicate is evaluated against the existing row
 * and EXCLUDED (the row that would have been inserted): a match lets the
 * conditional DO UPDATE proceed, a mismatch (a different owner already
 * holds the slug) leaves the row untouched and RETURNING empty, which the
 * caller maps to slug_conflict. visibility, draft_token,
 * owner_wallet_address, lp_locked_at and created_at are deliberately never
 * touched by the UPDATE SET, so a republish can never flip a live site back
 * to draft, mint a new draft token, or change ownership/history.
 */
async function upsertPublishedSite(
  client: PoolClientLike,
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
    ON CONFLICT (slug) DO UPDATE SET
      token_name = EXCLUDED.token_name,
      ticker = EXCLUDED.ticker,
      description = EXCLUDED.description,
      supply = EXCLUDED.supply,
      decimals = EXCLUDED.decimals,
      chain = EXCLUDED.chain,
      chain_id = EXCLUDED.chain_id,
      contract_address = EXCLUDED.contract_address,
      generated_html = EXCLUDED.generated_html,
      artwork_reference = EXCLUDED.artwork_reference,
      x_handle = EXCLUDED.x_handle,
      telegram = EXCLUDED.telegram,
      status = EXCLUDED.status
    WHERE lower(published_sites.owner_wallet_address) = lower(EXCLUDED.owner_wallet_address)
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

export function createPostgresPublishStore(
  databaseUrl: string,
  deps: { getPool?: (databaseUrl: string) => PostgresPoolLike } = {},
): PublishStore {
  const pool = (deps.getPool ?? ((url: string) => getPostgresPool(url) as unknown as PostgresPoolLike))(
    databaseUrl,
  );

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
        const inserted = await upsertPublishedSite(client, input.site, challenge.walletAddress);
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

    async listLive(): Promise<PublicGeneratedSite[]> {
      const result = await pool.query<PublishedSiteRow>(
        `SELECT ${SITE_COLUMNS}
           FROM published_sites
          WHERE visibility = 'live'
          ORDER BY created_at DESC
          LIMIT 100`,
      );
      return result.rows.map(siteFromRow).filter((site): site is PublicGeneratedSite => site !== null);
    },

    async updateContractAddress(input: UpdateContractAddressInput): Promise<UpdateContractAddressResult> {
      const result = await pool.query<PublishedSiteRow>(
        `UPDATE published_sites
            SET contract_address = $2
          WHERE slug = $1
          RETURNING ${SITE_COLUMNS}`,
        [input.slug, input.contractAddress],
      );
      const row = result.rows[0];
      if (!row) return { status: "site_not_found" };
      const site = siteFromRow(row);
      if (!site) throw new Error("The updated public site could not be mapped safely.");
      return { status: "updated", site };
    },
  };
}
