import { describe, expect, it } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";
import {
  BONDING_CURVE_ADDRESSES_ENV_VAR,
  HOODLUMS_BONDING_CURVE_READ_ABI,
  getBondingCurveAddress,
  getRobinhoodTestnetBondingCurveAddress,
  parseBondingCurveAddressMap,
} from "../lib/bonding-curve-config";

const VALID_ADDRESS = "0x1234567890123456789012345678901234567890";
const OTHER_ADDRESS = "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd";
const MONAD_TESTNET_CHAIN_ID = 10143;

type AbiItemShape = { type: string; name?: string; stateMutability?: string };
const abiItems = HOODLUMS_BONDING_CURVE_READ_ABI as unknown as readonly AbiItemShape[];

describe("bonding-curve-config", () => {
  describe("HOODLUMS_BONDING_CURVE_READ_ABI", () => {
    it("exposes exactly the read functions the graduation-status UI needs", () => {
      const names = abiItems.filter((item) => item.type === "function").map((item) => item.name).sort();
      expect(names).toEqual(
        ["funded", "graduated", "graduationTarget", "liquidityPool", "realNativeReserve"].sort(),
      );
    });

    it("exposes only view functions — this is a read-only slice of the contract", () => {
      const nonView = abiItems.filter(
        (item) => item.type === "function" && item.stateMutability !== "view",
      );
      expect(nonView).toEqual([]);
    });
  });

  describe("parseBondingCurveAddressMap", () => {
    it("returns an empty map for undefined or empty input", () => {
      expect(parseBondingCurveAddressMap(undefined)).toEqual({});
      expect(parseBondingCurveAddressMap("")).toEqual({});
    });

    it("returns an empty map for malformed JSON", () => {
      expect(parseBondingCurveAddressMap("{not json")).toEqual({});
    });

    it("returns an empty map for non-object JSON", () => {
      expect(parseBondingCurveAddressMap("[1,2,3]")).toEqual({});
      expect(parseBondingCurveAddressMap('"a string"')).toEqual({});
      expect(parseBondingCurveAddressMap("42")).toEqual({});
    });

    it("parses a valid chainId -> address map", () => {
      const raw = JSON.stringify({ [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS });
      expect(parseBondingCurveAddressMap(raw)).toEqual({
        [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
      });
    });

    it("drops entries with non-integer keys", () => {
      const raw = JSON.stringify({ notAChainId: VALID_ADDRESS, "-1": VALID_ADDRESS, "1.5": VALID_ADDRESS });
      expect(parseBondingCurveAddressMap(raw)).toEqual({});
    });

    it("drops entries with invalid address values", () => {
      const raw = JSON.stringify({ 46630: "not-an-address", 10143: 12345 });
      expect(parseBondingCurveAddressMap(raw)).toEqual({});
    });

    it("keeps valid entries while dropping invalid ones in the same map", () => {
      const raw = JSON.stringify({ 46630: VALID_ADDRESS, 10143: "not-an-address" });
      expect(parseBondingCurveAddressMap(raw)).toEqual({ 46630: VALID_ADDRESS });
    });

    it("supports multiple valid chains", () => {
      const raw = JSON.stringify({ 46630: VALID_ADDRESS, 10143: OTHER_ADDRESS });
      expect(parseBondingCurveAddressMap(raw)).toEqual({ 46630: VALID_ADDRESS, 10143: OTHER_ADDRESS });
    });
  });

  describe("getBondingCurveAddress", () => {
    it("returns undefined for every chain when the env var is unset — there is no public default yet", () => {
      expect(getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, {})).toBeUndefined();
      expect(getBondingCurveAddress(MONAD_TESTNET_CHAIN_ID, {})).toBeUndefined();
    });

    it("returns the configured address for the matching chain", () => {
      const env = {
        [BONDING_CURVE_ADDRESSES_ENV_VAR]: JSON.stringify({
          [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
        }),
      };
      expect(getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env)).toBe(VALID_ADDRESS);
    });

    it("does not leak an address configured for a different chain", () => {
      const env = { [BONDING_CURVE_ADDRESSES_ENV_VAR]: JSON.stringify({ [MONAD_TESTNET_CHAIN_ID]: OTHER_ADDRESS }) };
      expect(getBondingCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env)).toBeUndefined();
    });
  });

  describe("getRobinhoodTestnetBondingCurveAddress", () => {
    it("reads the Robinhood Chain Testnet entry from the shared env var", () => {
      const env = {
        [BONDING_CURVE_ADDRESSES_ENV_VAR]: JSON.stringify({
          [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
        }),
      };
      expect(getRobinhoodTestnetBondingCurveAddress(env)).toBe(VALID_ADDRESS);
    });

    it("returns undefined with no env var configured", () => {
      expect(getRobinhoodTestnetBondingCurveAddress({})).toBeUndefined();
    });
  });
});
