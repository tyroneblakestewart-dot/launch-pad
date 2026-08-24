import { getBondingCurveAddress } from "@/lib/bonding-curve-config";
import { getTokenLaunchesStore } from "@/lib/server/token-launches-store";

/**
 * Resolves the bonding curve that trades a specific token (issue #412 Part
 * 2). Each launch through HoodlumsCurveLaunchPipeline deploys its own curve,
 * so the single chain-wide env var in lib/bonding-curve-config.ts can no
 * longer identify the right curve once more than one token has launched
 * through the pipeline — this looks the launch up in token_launches first,
 * falling back to that legacy single-curve config only when no launch is
 * recorded for this token (e.g. a curve deployed by the manual deployment
 * drill, before this table existed). A storage error degrades to the
 * fallback rather than breaking the public token page.
 */
export async function resolveTokenCurveAddress(
  chainId: number,
  tokenAddress: string,
): Promise<`0x${string}` | null> {
  try {
    const launch = await getTokenLaunchesStore().findByTokenAddress(chainId, tokenAddress);
    if (launch) return launch.curveAddress as `0x${string}`;
  } catch {
    // Falls through to the legacy single-curve config below.
  }
  return getBondingCurveAddress(chainId) ?? null;
}
