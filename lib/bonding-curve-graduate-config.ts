import { isAddress, parseEther, type Address } from "viem";

// Config resolution for scripts/graduate-hoodlums-bonding-curve.ts. Kept as a
// pure, side-effect-free module (no Hardhat/network imports) so it can be
// unit tested directly. See README.md "Bonding curve deployment (drill)".

export const CURVE_ADDRESS_ENV_VAR = "HOODLUMS_BONDING_CURVE_ADDRESS";
export const BUY_STEP_ETHER_ENV_VAR = "HOODLUMS_BONDING_CURVE_BUY_STEP_ETHER";

/** Size of each intermediate buy while driving the curve toward graduation. */
export const DEFAULT_BUY_STEP_ETHER = "1";

export interface BondingCurveGraduateConfig {
  curveAddress: Address;
  buyStepWei: bigint;
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

/**
 * Resolves and validates config for the graduation-drive script. Pass `env`
 * explicitly in tests; defaults to `process.env`.
 */
export function resolveBondingCurveGraduateConfig(env: Env = process.env): BondingCurveGraduateConfig {
  const curveAddress = requireAddress(env, CURVE_ADDRESS_ENV_VAR);

  const buyStepRaw = env[BUY_STEP_ETHER_ENV_VAR] ?? DEFAULT_BUY_STEP_ETHER;
  let buyStepWei: bigint;
  try {
    buyStepWei = parseEther(buyStepRaw);
  } catch {
    throw new Error(`${BUY_STEP_ETHER_ENV_VAR} must be a decimal amount (e.g. "1"), got: ${buyStepRaw}`);
  }
  if (buyStepWei <= 0n) {
    throw new Error(`${BUY_STEP_ETHER_ENV_VAR} must be greater than zero, got: ${buyStepRaw}`);
  }

  return { curveAddress, buyStepWei };
}
