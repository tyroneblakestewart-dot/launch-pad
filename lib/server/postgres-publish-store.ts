import type { PoolClient } from "pg";
import type { PublicGeneratedSite } from "@/lib/public-site";
import { getPostgresPool } from "@/lib/server/postgres";
import type { PublishChallenge } from "@/lib/server/publish-auth";
import {
  sanitisePublishedGeneratedHtml,
  type PublishableSite,
} from "@/lib/server/published-site-validation";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";
import type {
  CreatePublishChallengeInput,
  PublishStore,
  PublishStoreResult,
  PublishWithChallengeInput,
  PublishSignatureVerifier,
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

function siteFromRow(row: PublishedSiteRow): PublicGeneratedSite | null {
  if (!isSupportedChain(row.chain) || !isProjectStatus(row.status)) return null;
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
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
  };
}

const SITE_COLUMNS = `
  slug, token_name, ticker, description, supply, decimals, chain, chain_id,
  contract_address, generated_html, artwork_reference, owner_wallet_address,
  x_handle, telegram, status, created_at, updated_at
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
      x_handle, telegram, status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15
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
    ],
  );
  return result.rows[0] || null;
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
        RETURNING id, nonce_hash, wallet_address, slug, wallet_chain_id,
                  site_payload_hash, issued_at, expires_at, used_at`,
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
          `SELECT id, nonce_hash, wallet_address, slug, wallet_chain_id,
                  site_payload_hash, issued_at, expires_at, used_at
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
