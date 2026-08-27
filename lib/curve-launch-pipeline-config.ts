import { parseAbi, parseEther, parseUnits } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "./chains";

/**
 * Mirrors the public interface of contracts/HoodlumsCurveLaunchPipeline.sol.
 * Only the entry point and the event a receipt needs decoding are included —
 * this contract exposes no other client-relevant surface.
 */
export const HOODLUMS_CURVE_LAUNCH_PIPELINE_ABI = parseAbi([
  "function launchTokenWithCurve(string name, string symbol, uint256 wholeTokenSupply, uint8 decimals, uint256 virtualTokenReserve, uint256 virtualEthReserve, uint256 graduationTarget) returns (address token, address curve)",
  "event TokenAndCurveLaunched(address indexed token, address indexed curve, address indexed creator, uint256 wholeTokenSupply, uint8 decimals, uint256 graduationTarget)",
]);

/**
 * The single write call the launch flow still needs on the freshly deployed
 * curve after approving it — funding it with the token's complete supply.
 * Kept separate from lib/bonding-curve-config.ts's read/trade ABIs (which
 * cover an already-configured, already-funded curve) since this is only
 * ever called once, immediately after a curve-backed launch.
 */
export const HOODLUMS_BONDING_CURVE_FUND_ABI = parseAbi(["function fundCurve()"]);

/**
 * The frontend reads a deployed pipeline address from a single env var,
 * mirroring FACTORY_ADDRESSES_ENV_VAR / getFactoryAddress in
 * lib/factory-config.ts, so wiring a newly deployed pipeline into the UI
 * never requires a code change:
 *
 *   NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES={"46630":"0xYourDeployedPipeline"}
 *
 * The value is public JSON, safe to expose to the browser. There is no
 * public default: like the bonding curve itself, the pipeline is not
 * deployed on any live network yet (Milestone A, issue #409) — an
 * unset/empty env var means the curve launch flow is unavailable for that
 * chain and the UI must fall back to the token-only launch path rather than
 * guessing an address.
 */
export const CURVE_LAUNCH_PIPELINE_ADDRESSES_ENV_VAR =
  "NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES";

export type CurveLaunchPipelineAddressMap = Partial<Record<number, `0x${string}`>>;

function isHexAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Parses the raw env var value into a chainId -> pipeline address map.
 * Malformed JSON, non-object shapes, and individual invalid entries are
 * dropped rather than thrown, since this runs at module load / render time.
 */
export function parseCurveLaunchPipelineAddressMap(
  raw: string | undefined,
): CurveLaunchPipelineAddressMap {
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const map: CurveLaunchPipelineAddressMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const chainId = Number(key);
    if (!Number.isInteger(chainId) || chainId <= 0) continue;
    if (!isHexAddress(value)) continue;
    map[chainId] = value;
  }
  return map;
}

/**
 * Reads the deployed curve-launch-pipeline address for a given chain id.
 * Pass `env` explicitly in tests; defaults to `process.env`. Returns
 * `undefined` when no pipeline is configured for that chain — callers must
 * treat that as "curve launch unavailable here", not as an error.
 */
export function getCurveLaunchPipelineAddress(
  chainId: number,
  env: Record<string, string | undefined> = DEFAULT_ENV,
): `0x${string}` | undefined {
  return parseCurveLaunchPipelineAddressMap(env[CURVE_LAUNCH_PIPELINE_ADDRESSES_ENV_VAR])[chainId];
}

/** Convenience accessor for the chain the pipeline is being prepared for. */
export function getRobinhoodTestnetCurveLaunchPipelineAddress(
  env: Record<string, string | undefined> = DEFAULT_ENV,
): `0x${string}` | undefined {
  return getCurveLaunchPipelineAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env);
}

// Curve deploy-parameter defaults (owner decisions, issue #409 Part 1): a LOW
// testnet graduation target so a faucet-funded wallet can ride a token to
// graduation, and the same illustrative starting-price curve used by
// contracts/HoodlumsTestBondingCurve.t.sol's default fixture and
// lib/bonding-curve-deploy-config.ts's manual deployment drill. Every launch
// through the pipeline uses these unless overridden — never inlined at a call
// site (rule from issue #409).
export const GRADUATION_TARGET_ETHER_ENV_VAR = "NEXT_PUBLIC_HOODLUMS_CURVE_GRADUATION_TARGET_ETHER";
export const VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR = "NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_ETH_RESERVE_ETHER";
export const VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR = "NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_TOKEN_RESERVE_WHOLE";

/**
 * Next.js only inlines NEXT_PUBLIC_ vars into client bundles when the access
 * is a static literal (process.env.NEXT_PUBLIC_X) — a dynamic lookup like
 * `process.env[someVar]` compiles to an empty object in the browser, so it
 * silently resolves to undefined client-side even though the var is set in
 * the deployment environment (issue #423). Every accessor below defaults to
 * this object instead of `process.env` directly so the browser actually
 * receives these values; tests keep injecting their own `env` object
 * unaffected.
 */
const DEFAULT_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES:
    process.env.NEXT_PUBLIC_HOODLUMS_CURVE_LAUNCH_PIPELINE_ADDRESSES,
  NEXT_PUBLIC_HOODLUMS_CURVE_GRADUATION_TARGET_ETHER:
    process.env.NEXT_PUBLIC_HOODLUMS_CURVE_GRADUATION_TARGET_ETHER,
  NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_ETH_RESERVE_ETHER:
    process.env.NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_ETH_RESERVE_ETHER,
  NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_TOKEN_RESERVE_WHOLE:
    process.env.NEXT_PUBLIC_HOODLUMS_CURVE_VIRTUAL_TOKEN_RESERVE_WHOLE,
};

export const DEFAULT_GRADUATION_TARGET_ETHER = "4";
export const DEFAULT_VIRTUAL_ETH_RESERVE_ETHER = "1";
export const DEFAULT_VIRTUAL_TOKEN_RESERVE_WHOLE = "1000000";

export interface CurveLaunchParams {
  graduationTargetWei: bigint;
  virtualEthReserveWei: bigint;
  virtualTokenReserveRaw: bigint;
}

function resolvePositiveEtherAmount(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: string,
): bigint {
  const raw = env[name] ?? defaultValue;
  let wei: bigint;
  try {
    wei = parseEther(raw);
  } catch {
    throw new Error(`${name} must be a decimal amount (e.g. "4"), got: ${raw}`);
  }
  if (wei <= 0n) {
    throw new Error(`${name} must be greater than zero, got: ${raw}`);
  }
  return wei;
}

/**
 * Resolves the curve deploy parameters (graduation target, virtual reserves)
 * a curve-backed launch should use, from public env vars with the testnet
 * defaults above. `tokenDecimals` scales the whole-token virtual reserve
 * default to the launching token's own decimals, matching
 * resolveBondingCurveDeployConfig's approach for the manual deployment drill.
 */
export function resolveCurveLaunchParams(
  tokenDecimals: number,
  env: Record<string, string | undefined> = DEFAULT_ENV,
): CurveLaunchParams {
  const graduationTargetWei = resolvePositiveEtherAmount(
    env,
    GRADUATION_TARGET_ETHER_ENV_VAR,
    DEFAULT_GRADUATION_TARGET_ETHER,
  );
  const virtualEthReserveWei = resolvePositiveEtherAmount(
    env,
    VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR,
    DEFAULT_VIRTUAL_ETH_RESERVE_ETHER,
  );

  const virtualTokenReserveWholeRaw =
    env[VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR] ?? DEFAULT_VIRTUAL_TOKEN_RESERVE_WHOLE;
  let virtualTokenReserveRaw: bigint;
  try {
    virtualTokenReserveRaw = parseUnits(virtualTokenReserveWholeRaw, tokenDecimals);
  } catch {
    throw new Error(
      `${VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR} must be a decimal whole-token amount, got: ${virtualTokenReserveWholeRaw}`,
    );
  }
  if (virtualTokenReserveRaw <= 0n) {
    throw new Error(
      `${VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR} must be greater than zero, got: ${virtualTokenReserveWholeRaw}`,
    );
  }

  return { graduationTargetWei, virtualEthReserveWei, virtualTokenReserveRaw };
}
