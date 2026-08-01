import { parseAbi } from "viem";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "./chains";

/**
 * Minimal read-only slice of contracts/HoodlumsTestBondingCurve.sol's public
 * interface: only the state needed to render graduation progress/status in
 * the UI (not-funded / bonding / graduated, plus the locked pool address).
 * Trading (buy/sell/withdrawFees) is out of scope for this read-only view.
 */
export const HOODLUMS_BONDING_CURVE_READ_ABI = parseAbi([
  "function funded() view returns (bool)",
  "function graduated() view returns (bool)",
  "function realNativeReserve() view returns (uint256)",
  "function graduationTarget() view returns (uint256)",
  "function liquidityPool() view returns (address)",
]);

/**
 * The frontend reads a deployed bonding-curve address from a single env var,
 * mirroring FACTORY_ADDRESSES_ENV_VAR / getFactoryAddress in
 * lib/factory-config.ts, so wiring a newly deployed curve into the UI never
 * requires a code change:
 *
 *   NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES={"46630":"0xYourDeployedCurve"}
 *
 * The value is public JSON, safe to expose to the browser. Unlike the
 * factory, there is no public default yet — per README.md "Bonding curve
 * deployment (drill)" the curve is not deployed on any live network, so an
 * unset/empty env var means no curve is configured for that chain and the
 * UI must show a "not deployed" state rather than guessing an address.
 */
export const BONDING_CURVE_ADDRESSES_ENV_VAR = "NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES";

export type BondingCurveAddressMap = Partial<Record<number, `0x${string}`>>;

function isHexAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Parses the raw env var value into a chainId -> bonding curve address map.
 * Malformed JSON, non-object shapes, and individual invalid entries are
 * dropped rather than thrown, since this runs at module load / render time.
 */
export function parseBondingCurveAddressMap(raw: string | undefined): BondingCurveAddressMap {
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

  const map: BondingCurveAddressMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const chainId = Number(key);
    if (!Number.isInteger(chainId) || chainId <= 0) continue;
    if (!isHexAddress(value)) continue;
    map[chainId] = value;
  }
  return map;
}

/**
 * Reads the deployed bonding-curve address for a given chain id from
 * NEXT_PUBLIC_HOODLUMS_BONDING_CURVE_ADDRESSES. Pass `env` explicitly in
 * tests; defaults to `process.env`. Returns `undefined` when no curve is
 * configured for that chain — callers must treat that as "not deployed yet",
 * not as an error.
 */
export function getBondingCurveAddress(
  chainId: number,
  env: Record<string, string | undefined> = process.env,
): `0x${string}` | undefined {
  return parseBondingCurveAddressMap(env[BONDING_CURVE_ADDRESSES_ENV_VAR])[chainId];
}

/** Convenience accessor for the chain the reference curve deployment drill targets. */
export function getRobinhoodTestnetBondingCurveAddress(
  env: Record<string, string | undefined> = process.env,
): `0x${string}` | undefined {
  return getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env);
}
