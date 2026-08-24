import { describe, expect, it } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";
import {
  CURVE_LAUNCH_PIPELINE_ADDRESSES_ENV_VAR,
  DEFAULT_GRADUATION_TARGET_ETHER,
  DEFAULT_VIRTUAL_ETH_RESERVE_ETHER,
  DEFAULT_VIRTUAL_TOKEN_RESERVE_WHOLE,
  GRADUATION_TARGET_ETHER_ENV_VAR,
  VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR,
  VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR,
  getCurveLaunchPipelineAddress,
  getRobinhoodTestnetCurveLaunchPipelineAddress,
  parseCurveLaunchPipelineAddressMap,
  resolveCurveLaunchParams,
} from "../lib/curve-launch-pipeline-config";

const VALID_ADDRESS = "0x1234567890123456789012345678901234567890";
const MONAD_TESTNET_CHAIN_ID = 10143;

describe("curve-launch-pipeline-config", () => {
  describe("parseCurveLaunchPipelineAddressMap", () => {
    it("returns an empty map for undefined, empty, or malformed input", () => {
      expect(parseCurveLaunchPipelineAddressMap(undefined)).toEqual({});
      expect(parseCurveLaunchPipelineAddressMap("")).toEqual({});
      expect(parseCurveLaunchPipelineAddressMap("{not json")).toEqual({});
    });

    it("parses a valid chainId -> address map", () => {
      const raw = JSON.stringify({ [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS });
      expect(parseCurveLaunchPipelineAddressMap(raw)).toEqual({
        [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
      });
    });

    it("drops invalid entries while keeping valid ones", () => {
      const raw = JSON.stringify({ 46630: VALID_ADDRESS, 10143: "not-an-address", notAChain: VALID_ADDRESS });
      expect(parseCurveLaunchPipelineAddressMap(raw)).toEqual({ 46630: VALID_ADDRESS });
    });
  });

  describe("getCurveLaunchPipelineAddress / getRobinhoodTestnetCurveLaunchPipelineAddress", () => {
    it("returns undefined when unset — no public default", () => {
      expect(getCurveLaunchPipelineAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, {})).toBeUndefined();
      expect(getRobinhoodTestnetCurveLaunchPipelineAddress({})).toBeUndefined();
    });

    it("returns the configured address for the matching chain only", () => {
      const env = {
        [CURVE_LAUNCH_PIPELINE_ADDRESSES_ENV_VAR]: JSON.stringify({
          [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
        }),
      };
      expect(getCurveLaunchPipelineAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env)).toBe(VALID_ADDRESS);
      expect(getCurveLaunchPipelineAddress(MONAD_TESTNET_CHAIN_ID, env)).toBeUndefined();
      expect(getRobinhoodTestnetCurveLaunchPipelineAddress(env)).toBe(VALID_ADDRESS);
    });
  });

  describe("resolveCurveLaunchParams", () => {
    it("uses the documented testnet defaults when nothing is configured", () => {
      const params = resolveCurveLaunchParams(18, {});
      expect(params.graduationTargetWei.toString()).toBe(
        (BigInt(DEFAULT_GRADUATION_TARGET_ETHER) * 10n ** 18n).toString(),
      );
      expect(params.virtualEthReserveWei.toString()).toBe(
        (BigInt(DEFAULT_VIRTUAL_ETH_RESERVE_ETHER) * 10n ** 18n).toString(),
      );
      expect(params.virtualTokenReserveRaw.toString()).toBe(
        (BigInt(DEFAULT_VIRTUAL_TOKEN_RESERVE_WHOLE) * 10n ** 18n).toString(),
      );
    });

    it("honours env overrides for each parameter", () => {
      const params = resolveCurveLaunchParams(18, {
        [GRADUATION_TARGET_ETHER_ENV_VAR]: "2",
        [VIRTUAL_ETH_RESERVE_ETHER_ENV_VAR]: "0.5",
        [VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR]: "500000",
      });
      expect(params.graduationTargetWei).toBe(2_000_000_000_000_000_000n);
      expect(params.virtualEthReserveWei).toBe(500_000_000_000_000_000n);
      expect(params.virtualTokenReserveRaw).toBe(500_000n * 10n ** 18n);
    });

    it("scales the virtual token reserve to the launching token's own decimals", () => {
      const params = resolveCurveLaunchParams(6, {
        [VIRTUAL_TOKEN_RESERVE_WHOLE_ENV_VAR]: "1000000",
      });
      expect(params.virtualTokenReserveRaw).toBe(1_000_000n * 10n ** 6n);
    });

    it("throws on a zero or negative graduation target", () => {
      expect(() => resolveCurveLaunchParams(18, { [GRADUATION_TARGET_ETHER_ENV_VAR]: "0" })).toThrow();
    });

    it("throws on a malformed decimal amount", () => {
      expect(() => resolveCurveLaunchParams(18, { [GRADUATION_TARGET_ETHER_ENV_VAR]: "not-a-number" })).toThrow();
    });
  });
});
