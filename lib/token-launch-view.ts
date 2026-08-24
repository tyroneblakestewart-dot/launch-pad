import type { TokenLaunch } from "@/lib/server/token-launches-store";

/**
 * The shape GET /api/token-launches actually returns (issue #412 Part 1):
 * each recorded launch plus live-read graduation progress and, when one
 * exists, the slug of a linked published Hoodlums site. bigint on-chain
 * values are serialised as decimal strings since JSON has no bigint type;
 * callers parse with BigInt(...) as needed. Progress fields are omitted
 * (not zeroed) when a live read wasn't attempted or failed, so the UI can
 * tell "graduated" and "read failed" apart from a genuine 0%.
 */
export interface TokenLaunchListItem extends TokenLaunch {
  /** 0-10000, matching HoodlumsTestBondingCurve's graduationProgressBps(). Absent if not read. */
  progressBps?: string;
  /** realNativeReserve() at read time, in wei. Absent if not read. */
  raisedWei?: string;
  /** The locked Uniswap V3 pool address once graduated, otherwise null. */
  liquidityPool?: string | null;
  /** Slug of a published Hoodlums site whose contractAddress matches this launch, if any. */
  siteSlug?: string | null;
}

export type TokenLaunchGridFilter = "all" | "bonding" | "graduated";
