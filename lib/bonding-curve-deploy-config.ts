import { isAddress, parseEther, parseUnits, type Address } from "viem";

// Config resolution for scripts/deploy-hoodlums-bonding-curve.ts. Kept as a
// pure, side-effect-free module (no Hardhat/network imports) so it can be
// unit tested directly. See README.md "Bonding curve deployment (drill)".

export const TOKEN_ADDRESS_ENV_VAR = "HOODLUMS_BONDING_CURVE_TOKEN_ADDRESS";
export const CREATOR_ADDRESS_ENV_VAR = "HOODLUMS_BONDING_CURVE_CREATOR_ADDRESS";
export const TREASURY_ADDRESS_ENV_VAR = "HOODLUMS_BONDING_CURVE_TREASURY_ADDRESS";
export const TOKEN_DECIMALS_ENV_VAR = "HOODLUMS_BONDING_CURVE_TOKEN_DECIMALS";
export const GRADUATION_TARGET_ETHER_ENV_VAR = "HOODLUMS_BONDING_CURVE_GRADUATION_TARGET_ETHER";
export const VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR = "HOODLUMS_BONDING_CURVE_VIRTUAL_ETH_RESERVE_ETHER";
export const VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR = "HOODLUMS_BONDING_CURVE_VIRTUAL_TOKEN_RESERVE_WHOLE";

/** Per the deployment drill request: graduate once 4 native testnet tokens accrue. */
export const DEFAULT_GRADUATION_TARGET_ETHER = "4";
/** Illustrative starting price curve, matching contracts/HoodlumsTestBondingCurve.t.sol's default fixture. */
export const DEFAULT_VIRTUAL_ETH_RESERVE_ETHER = "1";
export const DEFAULT_VIRTUAL_TOKEN_RESERVE_WHOLE = "1000000";
export const DEFAULT_TOKEN_DECIMALS = 18;

export interface BondingCurveDeployConfig {
  tokenAddress: Address;
  creatorAddress: Address;
  treasuryAddress: Address;
  tokenDecimals: number;
  graduationTargetWei: bigint;
  virtualEthReserveWei: bigint;
  virtualTokenReserveRaw: bigint;
}

type Env = Record<string, string | undefined>;

function requireEnv(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireAddress(env: Env, name: string): Address {
  const value = requireEnv(env, name);
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address, got: ${value}`);
  }
  return value;
}

function parsePositiveEtherAmount(env: Env, name: string, defaultValue: string): bigint {
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
 * Resolves and validates the constructor parameters for
 * HoodlumsTestBondingCurve from environment variables, mirroring the
 * requireEnv/requireAddress pattern in scripts/deploy-hoodlums-factory.ts.
 * Pass `env` explicitly in tests; defaults to `process.env`.
 */
export function resolveBondingCurveDeployConfig(env: Env = process.env): BondingCurveDeployConfig {
  const tokenAddress = requireAddress(env, TOKEN_ADDRESS_ENV_VAR);
  const creatorAddress = requireAddress(env, CREATOR_ADDRESS_ENV_VAR);
  const treasuryAddress = requireAddress(env, TREASURY_ADDRESS_ENV_VAR);

  const decimalsRaw = env[TOKEN_DECIMALS_ENV_VAR] ?? String(DEFAULT_TOKEN_DECIMALS);
  const tokenDecimals = Number(decimalsRaw);
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) {
    throw new Error(
      `${TOKEN_DECIMALS_ENV_VAR} must be an integer between 0 and 18, got: ${decimalsRaw}`,
    );
  }

  const graduationTargetWei = parsePositiveEtherAmount(
    env,
    GRADUATION_TARGET_ETHER_ENV_VAR,
    DEFAULT_GRADUATION_TARGET_ETHER,
  );
  const virtualEthReserveWei = parsePositiveEtherAmount(
    env,
    VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR,
    DEFAULT_VIRTUAL_ETH_RESERVE_ETHER,
  );

  const virtualTokenReserveWholeRaw = env[VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR] ?? DEFAULT_VIRTUAL_TOKEN_RESERVE_WHOLE;
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

  return {
    tokenAddress,
    creatorAddress,
    treasuryAddress,
    tokenDecimals,
    graduationTargetWei,
    virtualEthReserveWei,
    virtualTokenReserveRaw,
  };
}
