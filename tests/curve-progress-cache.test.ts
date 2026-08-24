import { afterEach, describe, expect, it, vi } from "vitest";
import { ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL } from "@/lib/chains";
import {
  getCurveProgress,
  getCurveProgressCacheHealth,
  resetCurveProgressCacheForTests,
  type CurveProgressReadClient,
} from "@/lib/server/curve-progress-cache";

const CURVE = "0x1234567890123456789012345678901234567890";

function fakeClient(overrides: Partial<Record<string, unknown>> = {}): {
  client: CurveProgressReadClient;
  readContract: ReturnType<typeof vi.fn>;
} {
  const values: Record<string, unknown> = {
    funded: true,
    graduated: false,
    realNativeReserve: 1_000_000_000_000_000_000n,
    graduationTarget: 4_000_000_000_000_000_000n,
    liquidityPool: "0x0000000000000000000000000000000000000000",
    ...overrides,
  };
  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]);
  return { client: { readContract } as unknown as CurveProgressReadClient, readContract };
}

afterEach(() => {
  resetCurveProgressCacheForTests();
});

describe("getCurveProgress", () => {
  it("returns null for a chain other than Robinhood Chain Testnet", async () => {
    const { client } = fakeClient();
    const result = await getCurveProgress(1, CURVE, { client, now: 0 });
    expect(result).toBeNull();
  });

  it("reads and computes graduation status from the curve's on-chain state", async () => {
    const { client } = fakeClient();
    const result = await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    expect(result).toMatchObject({ state: "bonding", raisedWei: 1_000_000_000_000_000_000n });
  });

  it("reuses a cached read within the TTL instead of calling the client again", async () => {
    const { client, readContract } = fakeClient();
    await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 5_000 });
    expect(readContract).toHaveBeenCalledTimes(5);
  });

  it("re-reads once the TTL has elapsed", async () => {
    const { client, readContract } = fakeClient();
    await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });
    await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 25_000 });
    expect(readContract).toHaveBeenCalledTimes(10);
  });

  it("dedupes concurrent misses for the same curve into a single read", async () => {
    const { client, readContract } = fakeClient();
    const [a, b] = await Promise.all([
      getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 }),
      getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 }),
    ]);
    expect(a).toEqual(b);
    expect(readContract).toHaveBeenCalledTimes(5);
  });

  it("falls back to the last cached value when a later read fails", async () => {
    const { client } = fakeClient();
    const first = await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 0 });

    const failingClient: CurveProgressReadClient = {
      readContract: vi.fn(async () => {
        throw new Error("RPC down");
      }),
    } as unknown as CurveProgressReadClient;
    const second = await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, {
      client: failingClient,
      now: 25_000,
    });

    expect(second).toEqual(first);
  });

  it("returns null on a failed read with no prior cached value", async () => {
    const failingClient: CurveProgressReadClient = {
      readContract: vi.fn(async () => {
        throw new Error("RPC down");
      }),
    } as unknown as CurveProgressReadClient;
    const result = await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client: failingClient, now: 0 });
    expect(result).toBeNull();
  });
});

describe("getCurveProgressCacheHealth", () => {
  it("reports no read yet before any call", () => {
    expect(getCurveProgressCacheHealth(0)).toEqual({ lastReadAt: null, lastReadOk: null, ageMs: null });
  });

  it("reports a successful read's timestamp and age", async () => {
    const { client } = fakeClient();
    await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client, now: 1_000 });
    expect(getCurveProgressCacheHealth(6_000)).toEqual({ lastReadAt: 1_000, lastReadOk: true, ageMs: 5_000 });
  });

  it("reports a failed read", async () => {
    const failingClient: CurveProgressReadClient = {
      readContract: vi.fn(async () => {
        throw new Error("RPC down");
      }),
    } as unknown as CurveProgressReadClient;
    await getCurveProgress(ROBINHOOD_TESTNET_CHAIN_ID_DECIMAL, CURVE, { client: failingClient, now: 2_000 });
    expect(getCurveProgressCacheHealth(2_000).lastReadOk).toBe(false);
  });
});
