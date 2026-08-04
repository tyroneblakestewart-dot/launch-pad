import { getPostgresPool } from "@/lib/server/postgres";
import type { SupportedChain } from "@/lib/types";

/**
 * Best-effort "Dev badge" lookup for the token chat tab (issue #237): the
 * only durable record this app keeps of who created a token is
 * `published_sites.owner_wallet_address` from the publish flow, keyed by
 * chain + contract address rather than slug here. Tokens that were never
 * published through Hoodlums simply have no known creator — this returns
 * null rather than guessing, and never throws (a lookup failure just means
 * no Dev badge is shown, it must not break the chat tab).
 */
export async function findTokenCreatorWalletAddress(
  chain: SupportedChain,
  contractAddress: string,
): Promise<string | null> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return null;

  try {
    const pool = getPostgresPool(databaseUrl);
    const result = await pool.query<{ owner_wallet_address: string }>(
      `SELECT owner_wallet_address
         FROM published_sites
        WHERE chain = $1 AND LOWER(contract_address) = LOWER($2)
        LIMIT 1`,
      [chain, contractAddress],
    );
    return result.rows[0]?.owner_wallet_address || null;
  } catch {
    return null;
  }
}
