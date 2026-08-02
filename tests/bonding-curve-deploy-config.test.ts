import { describe, expect, it } from "vitest";
import {
  CREATOR_ADDRESS_ENV_VAR,
  GRADUATION_TARGET_ETHER_ENV_VAR,
  POSITION_MANAGER_ADDRESS_ENV_VAR,
  TOKEN_ADDRESS_ENV_VAR,
  TOKEN_DECIMALS_ENV_VAR,
  TREASURY_ADDRESS_ENV_VAR,
  UNISWAP_V3_FACTORY_ADDRESS_ENV_VAR,
  VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR,
  VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR,
  WETH9_ADDRESS_ENV_VAR,
  resolveBondingCurveDeployConfig,
} from "../lib/bonding-curve-deploy-config";

// All-lowercase so viem's isAddress accepts them regardless of EIP-55 checksum casing.
const TOKEN_ADDRESS = "0x1234567890123456789012345678901234567890";
const CREATOR_ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const TREASURY_ADDRESS = "0x505217cbbe3059993877983b4fdad5c6e32af1f5";
// Built from a verified 10-hex-char block repeated 4x (=40 chars) so the
// length is correct by construction rather than by manually counting digits.
const POSITION_MANAGER_ADDRESS = `0x${"abcdefabcd".repeat(4)}` as const;
const UNISWAP_V3_FACTORY_ADDRESS = `0x${"1122334455".repeat(4)}` as const;
const WETH9_ADDRESS = `0x${"6677889900".repeat(4)}` as const;

const REQUIRED_ENV = {
  [TOKEN_ADDRESS_ENV_VAR]: TOKEN_ADDRESS,
  [CREATOR_ADDRESS_ENV_VAR]: CREATOR_ADDRESS,
  [TREASURY_ADDRESS_ENV_VAR]: TREASURY_ADDRESS,
  [POSITION_MANAGER_ADDRESS_ENV_VAR]: POSITION_MANAGER_ADDRESS,
  [UNISWAP_V3_FACTORY_ADDRESS_ENV_VAR]: UNISWAP_V3_FACTORY_ADDRESS,
  [WETH9_ADDRESS_ENV_VAR]: WETH9_ADDRESS,
};

describe("resolveBondingCurveDeployConfig", () => {
  it("resolves required addresses and applies documented defaults", () => {
    const config = resolveBondingCurveDeployConfig(REQUIRED_ENV);
    expect(config.tokenAddress).toBe(TOKEN_ADDRESS);
    expect(config.creatorAddress).toBe(CREATOR_ADDRESS);
    expect(config.treasuryAddress).toBe(TREASURY_ADDRESS);
    expect(config.tokenDecimals).toBe(18);
    expect(config.graduationTargetWei).toBe(4_000_000_000_000_000_000n);
    expect(config.virtualEthReserveWei).toBe(1_000_000_000_000_000_000n);
    expect(config.virtualTokenReserveRaw).toBe(1_000_000n * 10n ** 18n);
    expect(config.positionManagerAddress).toBe(POSITION_MANAGER_ADDRESS);
    expect(config.uniswapV3FactoryAddress).toBe(UNISWAP_V3_FACTORY_ADDRESS);
    expect(config.weth9Address).toBe(WETH9_ADDRESS);
  });

  it("throws when the Uniswap V3 position manager address is missing", () => {
    const rest = { ...REQUIRED_ENV };
    delete (rest as Record<string, string | undefined>)[POSITION_MANAGER_ADDRESS_ENV_VAR];
    expect(() => resolveBondingCurveDeployConfig(rest)).toThrow(
      `Missing required environment variable: ${POSITION_MANAGER_ADDRESS_ENV_VAR}`,
    );
  });

  it("throws when the Uniswap V3 factory address is missing", () => {
    const rest = { ...REQUIRED_ENV };
    delete (rest as Record<string, string | undefined>)[UNISWAP_V3_FACTORY_ADDRESS_ENV_VAR];
    expect(() => resolveBondingCurveDeployConfig(rest)).toThrow(
      `Missing required environment variable: ${UNISWAP_V3_FACTORY_ADDRESS_ENV_VAR}`,
    );
  });

  it("throws when the WETH9 address is missing", () => {
    const rest = { ...REQUIRED_ENV };
    delete (rest as Record<string, string | undefined>)[WETH9_ADDRESS_ENV_VAR];
    expect(() => resolveBondingCurveDeployConfig(rest)).toThrow(
      `Missing required environment variable: ${WETH9_ADDRESS_ENV_VAR}`,
    );
  });

  it("throws when a required address is missing", () => {
    const rest = { ...REQUIRED_ENV };
    delete (rest as Record<string, string | undefined>)[TOKEN_ADDRESS_ENV_VAR];
    expect(() => resolveBondingCurveDeployConfig(rest)).toThrow(
      `Missing required environment variable: ${TOKEN_ADDRESS_ENV_VAR}`,
    );
  });

  it("throws when an address env var is not a valid 0x address", () => {
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [CREATOR_ADDRESS_ENV_VAR]: "not-an-address" }),
    ).toThrow(`${CREATOR_ADDRESS_ENV_VAR} must be a valid 0x address`);
  });

  it("respects an overridden token decimals value", () => {
    const config = resolveBondingCurveDeployConfig({
      ...REQUIRED_ENV,
      [TOKEN_DECIMALS_ENV_VAR]: "6",
      [VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR]: "1000000",
    });
    expect(config.tokenDecimals).toBe(6);
    expect(config.virtualTokenReserveRaw).toBe(1_000_000n * 10n ** 6n);
  });

  it("rejects an out-of-range token decimals value", () => {
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [TOKEN_DECIMALS_ENV_VAR]: "19" }),
    ).toThrow(`${TOKEN_DECIMALS_ENV_VAR} must be an integer between 0 and 18`);
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [TOKEN_DECIMALS_ENV_VAR]: "abc" }),
    ).toThrow(`${TOKEN_DECIMALS_ENV_VAR} must be an integer between 0 and 18`);
  });

  it("respects an overridden graduation target", () => {
    const config = resolveBondingCurveDeployConfig({
      ...REQUIRED_ENV,
      [GRADUATION_TARGET_ETHER_ENV_VAR]: "10.5",
    });
    expect(config.graduationTargetWei).toBe(10_500_000_000_000_000_000n);
  });

  it("rejects a zero or malformed graduation target", () => {
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [GRADUATION_TARGET_ETHER_ENV_VAR]: "0" }),
    ).toThrow(`${GRADUATION_TARGET_ETHER_ENV_VAR} must be greater than zero`);
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [GRADUATION_TARGET_ETHER_ENV_VAR]: "not-a-number" }),
    ).toThrow(`${GRADUATION_TARGET_ETHER_ENV_VAR} must be a decimal amount`);
  });

  it("rejects a zero virtual native reserve", () => {
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR]: "0" }),
    ).toThrow(`${VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR} must be greater than zero`);
  });

  it("rejects a zero or malformed virtual token reserve", () => {
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR]: "0" }),
    ).toThrow(`${VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR} must be greater than zero`);
    expect(() =>
      resolveBondingCurveDeployConfig({ ...REQUIRED_ENV, [VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR]: "not-a-number" }),
    ).toThrow(`${VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR} must be a decimal whole-token amount`);
  });
});
