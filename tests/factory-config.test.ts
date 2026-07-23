import { describe, expect, it } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "../lib/chains";
import {
  DEFAULT_FACTORY_ADDRESSES,
  FACTORY_ADDRESSES_ENV_VAR,
  HOODLUMS_TOKEN_FACTORY_ABI,
  getFactoryAddress,
  getRobinhoodTestnetFactoryAddress,
  parseFactoryAddressMap,
} from "../lib/factory-config";

const VALID_ADDRESS = "0x1234567890123456789012345678901234567890";
const OTHER_ADDRESS = "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd";

// Loosened view of the ABI for existence checks below. The exported ABI's
// per-item literal types (constructor/receive lack `name`) are precise on
// purpose for real callers; that precision just makes ad-hoc lookups here
// more annoying to type, so we widen locally instead of on the export.
type AbiItemShape = { type: string; name?: string; stateMutability?: string };
const abiItems = HOODLUMS_TOKEN_FACTORY_ABI as unknown as readonly AbiItemShape[];

describe("factory-config", () => {
  describe("HOODLUMS_TOKEN_FACTORY_ABI", () => {
    it("exposes the launchToken function used to create tokens", () => {
      const launchToken = abiItems.find(
        (item) => item.type === "function" && item.name === "launchToken",
      );
      expect(launchToken).toBeDefined();
      expect(launchToken?.stateMutability).toBe("payable");
    });

    it("exposes read functions the frontend needs before launching", () => {
      const names = abiItems.filter((item) => item.type === "function").map((item) => item.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "launchFee",
          "MAX_LAUNCH_FEE",
          "feeRecipient",
          "owner",
          "launchCount",
          "isFactoryToken",
        ]),
      );
    });

    it("exposes the TokenLaunched event", () => {
      const event = abiItems.find((item) => item.type === "event" && item.name === "TokenLaunched");
      expect(event).toBeDefined();
    });
  });

  describe("parseFactoryAddressMap", () => {
    it("returns an empty map for undefined or empty input", () => {
      expect(parseFactoryAddressMap(undefined)).toEqual({});
      expect(parseFactoryAddressMap("")).toEqual({});
    });

    it("returns an empty map for malformed JSON", () => {
      expect(parseFactoryAddressMap("{not json")).toEqual({});
    });

    it("returns an empty map for non-object JSON", () => {
      expect(parseFactoryAddressMap("[1,2,3]")).toEqual({});
      expect(parseFactoryAddressMap('"a string"')).toEqual({});
      expect(parseFactoryAddressMap("42")).toEqual({});
    });

    it("parses a valid chainId -> address map", () => {
      const raw = JSON.stringify({ [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS });
      expect(parseFactoryAddressMap(raw)).toEqual({
        [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
      });
    });

    it("drops entries with non-integer keys", () => {
      const raw = JSON.stringify({ notAChainId: VALID_ADDRESS, "-1": VALID_ADDRESS, "1.5": VALID_ADDRESS });
      expect(parseFactoryAddressMap(raw)).toEqual({});
    });

    it("drops entries with invalid address values", () => {
      const raw = JSON.stringify({ 46630: "not-an-address", 10143: 12345 });
      expect(parseFactoryAddressMap(raw)).toEqual({});
    });

    it("keeps valid entries while dropping invalid ones in the same map", () => {
      const raw = JSON.stringify({
        46630: VALID_ADDRESS,
        10143: "not-an-address",
      });
      expect(parseFactoryAddressMap(raw)).toEqual({ 46630: VALID_ADDRESS });
    });

    it("supports multiple valid chains", () => {
      const raw = JSON.stringify({ 46630: VALID_ADDRESS, 10143: OTHER_ADDRESS });
      expect(parseFactoryAddressMap(raw)).toEqual({ 46630: VALID_ADDRESS, 10143: OTHER_ADDRESS });
    });
  });

  describe("getFactoryAddress", () => {
    it("falls back to the public default when the env var is unset", () => {
      expect(getFactoryAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, {})).toBe(
        DEFAULT_FACTORY_ADDRESSES[ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL],
      );
    });

    it("returns undefined for a chain with no default and no env entry", () => {
      const env = { [FACTORY_ADDRESSES_ENV_VAR]: JSON.stringify({ 10143: OTHER_ADDRESS }) };
      expect(getFactoryAddress(999999, env)).toBeUndefined();
    });

    it("returns the env-configured address for a known chain, overriding the default", () => {
      const env = {
        [FACTORY_ADDRESSES_ENV_VAR]: JSON.stringify({
          [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
        }),
      };
      expect(getFactoryAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, env)).toBe(VALID_ADDRESS);
    });
  });

  describe("getRobinhoodTestnetFactoryAddress", () => {
    it("reads the Robinhood Chain Testnet entry from the shared env var, overriding the default", () => {
      const env = {
        [FACTORY_ADDRESSES_ENV_VAR]: JSON.stringify({
          [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: VALID_ADDRESS,
        }),
      };
      expect(getRobinhoodTestnetFactoryAddress(env)).toBe(VALID_ADDRESS);
    });

    it("returns the public default deployment when no env override is set", () => {
      expect(getRobinhoodTestnetFactoryAddress({})).toBe(
        DEFAULT_FACTORY_ADDRESSES[ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL],
      );
    });
  });

  describe("DEFAULT_FACTORY_ADDRESSES", () => {
    it("configures the live Robinhood Chain Testnet factory deployment", () => {
      expect(DEFAULT_FACTORY_ADDRESSES[ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]).toBe(
        "0x39207baa4d0a30a5194770563ec586978c9fbcb3",
      );
    });
  });
});
