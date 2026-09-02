import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTokenLaunchesStore,
  resetTokenLaunchesStoreForTests,
  setTokenLaunchesStoreForTests,
  TokenLaunchesStoreUnavailableError,
  type ListTokenLaunchesFilter,
  type RecordTokenLaunchInput,
  type TokenLaunch,
  type TokenLaunchesStore,
} from "@/lib/server/token-launches-store";

// In-memory TokenLaunchesStore for tests, mirroring
// tests/support-tickets-test-helpers.ts's createMemorySupportTicketsStore
// pattern: exercises the interface contract without a real Postgres instance.
function createMemoryTokenLaunchesStore(): TokenLaunchesStore {
  const launches = new Map<string, TokenLaunch>();

  function key(chainId: number, tokenAddress: string): string {
    return `${chainId}:${tokenAddress.toLowerCase()}`;
  }

  return {
    async record(input: RecordTokenLaunchInput) {
      const existingKey = key(input.chainId, input.tokenAddress);
      const existing = [...launches.values()].find((l) => key(l.chainId, l.tokenAddress) === existingKey);
      if (existing) {
        // Mirrors the real store's ON CONFLICT ... COALESCE: fills in
        // artwork on a double-submitted record if the first attempt had
        // none, but never overwrites artwork already recorded.
        if (!existing.artworkThumbnail && input.artworkThumbnail) {
          const merged = { ...existing, artworkThumbnail: input.artworkThumbnail };
          launches.set(existing.id, merged);
          return merged;
        }
        return existing;
      }

      const launch: TokenLaunch = {
        id: randomUUID(),
        chainId: input.chainId,
        tokenAddress: input.tokenAddress,
        curveAddress: input.curveAddress,
        creatorWalletAddress: input.creatorWalletAddress,
        tokenName: input.tokenName,
        ticker: input.ticker,
        decimals: input.decimals,
        wholeTokenSupply: input.wholeTokenSupply,
        graduationTargetWei: input.graduationTargetWei,
        graduated: false,
        graduatedAt: null,
        launchedAt: new Date().toISOString(),
        artworkThumbnail: input.artworkThumbnail,
      };
      launches.set(launch.id, launch);
      return launch;
    },

    async list(filter: ListTokenLaunchesFilter, limit: number) {
      return [...launches.values()]
        .filter((l) => filter === "all" || (filter === "graduated" ? l.graduated : !l.graduated))
        .sort((a, b) => new Date(b.launchedAt).getTime() - new Date(a.launchedAt).getTime())
        .slice(0, limit);
    },

    async listForAdmin() {
      return [...launches.values()].sort(
        (a, b) => new Date(b.launchedAt).getTime() - new Date(a.launchedAt).getTime(),
      );
    },

    async findByTokenAddress(chainId: number, tokenAddress: string) {
      return [...launches.values()].find((l) => key(l.chainId, l.tokenAddress) === key(chainId, tokenAddress)) ?? null;
    },

    async findTokenLaunchCreatedAtByCurveAddress() {
      return null;
    },

    async findTokenLaunchGraduatedAtByCurveAddress() {
      return null;
    },

    async markGraduated(chainId: number, tokenAddress: string, graduatedAt: Date) {
      const found = [...launches.values()].find((l) => key(l.chainId, l.tokenAddress) === key(chainId, tokenAddress));
      if (!found || found.graduated) return;
      launches.set(found.id, { ...found, graduated: true, graduatedAt: graduatedAt.toISOString() });
    },

    async countLast24h() {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return [...launches.values()].filter((l) => new Date(l.launchedAt).getTime() >= cutoff).length;
    },

    async tableExists() {
      return true;
    },
  };
}

const SAMPLE: RecordTokenLaunchInput = {
  chainId: 46630,
  tokenAddress: "0x1111111111111111111111111111111111111111",
  curveAddress: "0x2222222222222222222222222222222222222222",
  creatorWalletAddress: "0x3333333333333333333333333333333333333333",
  tokenName: "Test Token",
  ticker: "TEST",
  decimals: 18,
  wholeTokenSupply: "1000000",
  graduationTargetWei: "4000000000000000000",
  artworkThumbnail: null,
};

afterEach(() => {
  resetTokenLaunchesStoreForTests();
});

describe("TokenLaunchesStore contract (via in-memory double)", () => {
  it("records a launch that starts ungraduated", async () => {
    const store = createMemoryTokenLaunchesStore();
    const launch = await store.record(SAMPLE);
    expect(launch.graduated).toBe(false);
    expect(launch.graduatedAt).toBeNull();
    expect(launch.tokenAddress).toBe(SAMPLE.tokenAddress);
  });

  it("is idempotent under a double-submitted (chainId, tokenAddress) record", async () => {
    const store = createMemoryTokenLaunchesStore();
    const first = await store.record(SAMPLE);
    const second = await store.record(SAMPLE);
    expect(second.id).toBe(first.id);
    expect(await store.countLast24h()).toBe(1);
  });

  it("filters list() by graduation state", async () => {
    const store = createMemoryTokenLaunchesStore();
    await store.record(SAMPLE);
    await store.record({ ...SAMPLE, tokenAddress: "0x4444444444444444444444444444444444444444" });
    await store.markGraduated(SAMPLE.chainId, SAMPLE.tokenAddress, new Date());

    expect(await store.list("all", 10)).toHaveLength(2);
    expect(await store.list("graduated", 10)).toHaveLength(1);
    expect(await store.list("bonding", 10)).toHaveLength(1);
  });

  it("finds a launch by (chainId, tokenAddress) case-insensitively", async () => {
    const store = createMemoryTokenLaunchesStore();
    await store.record(SAMPLE);
    const found = await store.findByTokenAddress(SAMPLE.chainId, SAMPLE.tokenAddress.toUpperCase());
    expect(found?.tokenAddress).toBe(SAMPLE.tokenAddress);
    expect(await store.findByTokenAddress(SAMPLE.chainId, "0x9999999999999999999999999999999999999")).toBeNull();
  });

  it("round-trips a recorded artwork thumbnail and defaults to null when absent", async () => {
    const store = createMemoryTokenLaunchesStore();
    const withoutArt = await store.record(SAMPLE);
    expect(withoutArt.artworkThumbnail).toBeNull();

    const dataUrl = "data:image/webp;base64,AAAA";
    const withArt = await store.record({
      ...SAMPLE,
      tokenAddress: "0x5555555555555555555555555555555555555555",
      artworkThumbnail: dataUrl,
    });
    expect(withArt.artworkThumbnail).toBe(dataUrl);

    const found = await store.findByTokenAddress(SAMPLE.chainId, withArt.tokenAddress);
    expect(found?.artworkThumbnail).toBe(dataUrl);
  });

  it("a double-submitted record fills in missing artwork without overwriting existing artwork", async () => {
    const store = createMemoryTokenLaunchesStore();
    const first = await store.record(SAMPLE);
    expect(first.artworkThumbnail).toBeNull();

    const filledIn = await store.record({ ...SAMPLE, artworkThumbnail: "data:image/webp;base64,BBBB" });
    expect(filledIn.id).toBe(first.id);
    expect(filledIn.artworkThumbnail).toBe("data:image/webp;base64,BBBB");

    const ignored = await store.record({ ...SAMPLE, artworkThumbnail: "data:image/webp;base64,CCCC" });
    expect(ignored.artworkThumbnail).toBe("data:image/webp;base64,BBBB");
  });

  it("markGraduated is a no-op once already graduated", async () => {
    const store = createMemoryTokenLaunchesStore();
    await store.record(SAMPLE);
    const firstGraduatedAt = new Date("2026-01-01T00:00:00.000Z");
    await store.markGraduated(SAMPLE.chainId, SAMPLE.tokenAddress, firstGraduatedAt);
    await store.markGraduated(SAMPLE.chainId, SAMPLE.tokenAddress, new Date("2026-06-01T00:00:00.000Z"));

    const [launch] = await store.list("graduated", 10);
    expect(launch.graduatedAt).toBe(firstGraduatedAt.toISOString());
  });
});

describe("getTokenLaunchesStore (unconfigured fallback)", () => {
  it("throws TokenLaunchesStoreUnavailableError from record() without DATABASE_URL", async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(getTokenLaunchesStore().record(SAMPLE)).rejects.toBeInstanceOf(TokenLaunchesStoreUnavailableError);
    } finally {
      if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
    }
  });

  it("degrades reads to empty/zero/false rather than throwing", async () => {
    const originalUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const store = getTokenLaunchesStore();
      expect(await store.list("all", 10)).toEqual([]);
      expect(await store.listForAdmin()).toEqual([]);
      expect(await store.findByTokenAddress(46630, SAMPLE.tokenAddress)).toBeNull();
      expect(await store.countLast24h()).toBe(0);
      expect(await store.tableExists()).toBe(false);
    } finally {
      if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl;
    }
  });

  it("setTokenLaunchesStoreForTests overrides the resolved store", async () => {
    const memoryStore = createMemoryTokenLaunchesStore();
    setTokenLaunchesStoreForTests(memoryStore);
    expect(getTokenLaunchesStore()).toBe(memoryStore);
  });
});
