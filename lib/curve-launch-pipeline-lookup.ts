import { type Address, type PublicClient, getAddress, parseAbi, parseAbiItem } from "viem";

/**
 * Resolves a HoodlumsCurveLaunchPipeline-backed launch from only a token
 * address, for the "Record an existing launch" recovery affordance (issue
 * #425). The pipeline itself keeps no token->curve mapping (see
 * contracts/HoodlumsCurveLaunchPipeline.sol), so the curve address and the
 * launch-time facts (whole-token supply, decimals, graduation target) are
 * read back from the pipeline's own `TokenAndCurveLaunched` event log, and
 * the token's name/symbol are read from the token contract itself — every
 * field POST /api/token-launches's payload needs. This is only ever a
 * *claim*: lib/server/token-launch-reconciliation.ts independently
 * re-derives the same facts from a live chain read before the server ever
 * trusts it, so nothing here weakens that verification.
 */

const TOKEN_AND_CURVE_LAUNCHED_EVENT = parseAbiItem(
  "event TokenAndCurveLaunched(address indexed token, address indexed curve, address indexed creator, uint256 wholeTokenSupply, uint8 decimals, uint256 graduationTarget)",
);

const TOKEN_METADATA_READ_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);

/** Narrow slice of viem's PublicClient this module needs — narrow enough to stub with a plain object in tests. */
export type PipelineLaunchLookupClient = Pick<PublicClient, "getLogs" | "readContract">;

export type ResolvedPipelineLaunch = {
  tokenAddress: Address;
  curveAddress: Address;
  tokenName: string;
  ticker: string;
  decimals: number;
  wholeTokenSupply: string;
  graduationTargetWei: bigint;
};

export class LaunchLookupError extends Error {}

/**
 * Given a token address, finds the curve HoodlumsCurveLaunchPipeline
 * deployed for it and assembles the recordTokenLaunch payload the server
 * will independently verify. Throws LaunchLookupError with a plain-English
 * message on an invalid address or no matching launch.
 */
export async function resolvePipelineLaunchByTokenAddress(
  client: PipelineLaunchLookupClient,
  pipelineAddress: Address,
  rawTokenAddress: string,
): Promise<ResolvedPipelineLaunch> {
  let tokenAddress: Address;
  try {
    tokenAddress = getAddress(rawTokenAddress.trim());
  } catch {
    throw new LaunchLookupError("Enter a valid token address.");
  }

  const logs = await client.getLogs({
    address: pipelineAddress,
    event: TOKEN_AND_CURVE_LAUNCHED_EVENT,
    args: { token: tokenAddress },
    fromBlock: 0n,
    toBlock: "latest",
  });
  const launchLog = logs.at(-1);
  const { curve, wholeTokenSupply, decimals, graduationTarget } = launchLog?.args ?? {};
  if (!curve || wholeTokenSupply === undefined || decimals === undefined || graduationTarget === undefined) {
    throw new LaunchLookupError(
      "No curve-backed launch was found for that token address on this pipeline.",
    );
  }

  const [tokenName, ticker] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: TOKEN_METADATA_READ_ABI, functionName: "name" }),
    client.readContract({ address: tokenAddress, abi: TOKEN_METADATA_READ_ABI, functionName: "symbol" }),
  ]);

  return {
    tokenAddress,
    curveAddress: curve,
    tokenName,
    ticker,
    decimals,
    wholeTokenSupply: wholeTokenSupply.toString(),
    graduationTargetWei: graduationTarget,
  };
}
