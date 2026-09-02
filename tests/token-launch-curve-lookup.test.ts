import { afterEach, describe, expect, it } from "vitest";
import { BONDING_CURVE_ADDRESSES_ENV_VAR } from "@/lib/bonding-curve-config";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import { resolveTokenCurveAddress } from "@/lib/server/token-launch-curve-lookup";
import {
  resetTokenLaunchesStoreForTests,
  setTokenLaunchesStoreForTests,
  type TokenLaunch,
  type TokenLaunchesStore,
} from "@/lib/server/token-launches-store";

const TOKEN_ADDRESS = "0x1111111111111111111111111111111111111111";
const RECORDED_CURVE = "0x2222222222222222222222222222222222222222";
const LEGACY_CURVE = "0x3333333333333333333333333333333333333333";

function fakeStore(overrides: Partial<TokenLaunchesStore> = {}): TokenLaunchesStore {
  return {
    async record() {
      throw new Error("not used");
    },
    async list() {
      return [];
    },
    async listForAdmin() {
      return [];
    },
    async findByTokenAddress() {
      return null;
    },
    async findTokenLaunchCreatedAtByCurveAddress() {
      return null;
    },
    async findTokenLaunchGraduatedAtByCurveAddress() {
      return null;
    },
    async markGraduated() {},
    async countLast24h() {
      return 0;
    },
    async tableExists() {
      return true;
    },
    ...overrides,
  };
}

function launch(overrides: Partial<TokenLaunch> = {}): TokenLaunch {
  return {
    id: "id-1",
    chainId: ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL,
    tokenAddress: TOKEN_ADDRESS,
    curveAddress: RECORDED_CURVE,
    creatorWalletAddress: "0x4444444444444444444444444444444444444444",
    tokenName: "Test",
    ticker: "TEST",
    decimals: 18,
    wholeTokenSupply: "1000000",
    graduationTargetWei: "4000000000000000000",
    graduated: false,
    graduatedAt: null,
    launchedAt: new Date().toISOString(),
    artworkThumbnail: null,
    ...overrides,
  };
}

const ORIGINAL_CURVE_ENV = process.env[BONDING_CURVE_ADDRESSES_ENV_VAR];

afterEach(() => {
  resetTokenLaunchesStoreForTests();
  if (ORIGINAL_CURVE_ENV === undefined) delete process.env[BONDING_CURVE_ADDRESSES_ENV_VAR];
  else process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = ORIGINAL_CURVE_ENV;
});

describe("resolveTokenCurveAddress", () => {
  it("prefers the curve recorded in token_launches for this token", async () => {
    setTokenLaunchesStoreForTests(fakeStore({ findByTokenAddress: async () => launch() }));
    process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = JSON.stringify({
      [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: LEGACY_CURVE,
    });

    const result = await resolveTokenCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN_ADDRESS);
    expect(result).toBe(RECORDED_CURVE);
  });

  it("falls back to the legacy single-curve env var when no launch is recorded", async () => {
    setTokenLaunchesStoreForTests(fakeStore());
    process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = JSON.stringify({
      [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: LEGACY_CURVE,
    });

    const result = await resolveTokenCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN_ADDRESS);
    expect(result).toBe(LEGACY_CURVE);
  });

  it("returns null when neither a recorded launch nor a legacy env var resolves", async () => {
    setTokenLaunchesStoreForTests(fakeStore());
    delete process.env[BONDING_CURVE_ADDRESSES_ENV_VAR];

    const result = await resolveTokenCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN_ADDRESS);
    expect(result).toBeNull();
  });

  it("falls back to the legacy env var when the store throws", async () => {
    setTokenLaunchesStoreForTests(
      fakeStore({
        findByTokenAddress: async () => {
          throw new Error("db down");
        },
      }),
    );
    process.env[BONDING_CURVE_ADDRESSES_ENV_VAR] = JSON.stringify({
      [ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL]: LEGACY_CURVE,
    });

    const result = await resolveTokenCurveAddress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, TOKEN_ADDRESS);
    expect(result).toBe(LEGACY_CURVE);
  });
});
