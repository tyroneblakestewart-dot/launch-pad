import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClientErrorStoreUnavailableError,
  getClientErrorStore,
  resetClientErrorStoreForTests,
} from "@/lib/server/client-errors-store";
import { MemoryClientErrorStore } from "./client-errors-test-helpers";

function input(overrides: Partial<Parameters<MemoryClientErrorStore["recordError"]>[0]> = {}) {
  return {
    message: "Cannot read properties of undefined (reading 'filter')",
    stack: "TypeError: ...\n  at Component (app.js:1:1)",
    routePath: "/social",
    walletAddress: null,
    userAgent: "Mozilla/5.0",
    viewportWidth: 390,
    buildId: "abc1234",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("client-error grouping", () => {
  it("groups occurrences by exact message + route, counting occurrences and distinct wallets", async () => {
    const store = new MemoryClientErrorStore();
    await store.recordError(input({ walletAddress: "0x1111111111111111111111111111111111111111" }));
    await store.recordError(input({ walletAddress: "0x2222222222222222222222222222222222222222" }));
    await store.recordError(input({ walletAddress: "0x1111111111111111111111111111111111111111" }));
    await store.recordError(input({ walletAddress: null }));

    const snapshot = await store.listGroups();
    expect(snapshot.status).toBe("ready");
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]).toMatchObject({
      message: input().message,
      routePath: "/social",
      occurrenceCount: 4,
      distinctWallets: 2,
    });
  });

  it("keeps different messages and different routes as separate groups", async () => {
    const store = new MemoryClientErrorStore();
    await store.recordError(input({ message: "Error A" }));
    await store.recordError(input({ message: "Error B" }));
    await store.recordError(input({ routePath: "/hoodchat" }));

    const snapshot = await store.listGroups();
    expect(snapshot.groups).toHaveLength(3);
  });

  it("orders groups by occurrence count first, then by most recently seen", async () => {
    const store = new MemoryClientErrorStore();
    await store.recordError(input({ message: "Rare error" }));
    await store.recordError(input({ message: "Frequent error" }));
    await store.recordError(input({ message: "Frequent error" }));
    await store.recordError(input({ message: "Frequent error" }));

    const snapshot = await store.listGroups();
    expect(snapshot.groups[0].message).toBe("Frequent error");
    expect(snapshot.groups[0].occurrenceCount).toBe(3);
  });

  it("excludes a resolved group from listGroups", async () => {
    const store = new MemoryClientErrorStore();
    await store.recordError(input());

    const before = await store.listGroups();
    expect(before.groups).toHaveLength(1);

    const result = await store.resolveGroup(input().message, input().routePath);
    expect(result).toBe("resolved");

    const after = await store.listGroups();
    expect(after.groups).toHaveLength(0);
  });

  it("re-surfaces a resolved group once a fresh occurrence lands after the resolution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new MemoryClientErrorStore();
    await store.recordError(input());

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    await store.resolveGroup(input().message, input().routePath);
    expect((await store.listGroups()).groups).toHaveLength(0);

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    await store.recordError(input());
    const after = await store.listGroups();
    expect(after.groups).toHaveLength(1);
    expect(after.groups[0].occurrenceCount).toBe(2);
  });

  it("returns not_found when resolving a group with no matching occurrences", async () => {
    const store = new MemoryClientErrorStore();
    const result = await store.resolveGroup("no such message", "/nowhere");
    expect(result).toBe("not_found");
  });

  it("counts only groups whose first-ever occurrence fell within the window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new MemoryClientErrorStore();
    await store.recordError(input({ message: "Old error" }));

    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    const since = new Date("2026-01-01T12:00:00.000Z");
    await store.recordError(input({ message: "New error" }));

    const count = await store.countNewGroupsSince(since);
    expect(count).toBe(1);
  });

  it("counts only one wallet's occurrences within the window, case-insensitively (issue #393)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new MemoryClientErrorStore();
    await store.recordError(input({ walletAddress: "0xAAAA111111111111111111111111111111111111" }));
    await store.recordError(input({ walletAddress: "0xbbbb222222222222222222222222222222222222" }));

    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    await store.recordError(input({ walletAddress: "0xaaaa111111111111111111111111111111111111" }));

    const since = new Date("2025-12-01T00:00:00.000Z");
    expect(await store.countRecentForWallet("0xAAAA111111111111111111111111111111111111", since)).toBe(2);
    expect(await store.countRecentForWallet("0xbbbb222222222222222222222222222222222222", since)).toBe(1);
    expect(await store.countRecentForWallet("0xcccc333333333333333333333333333333333333", since)).toBe(0);

    const recentOnly = new Date("2026-01-01T12:00:00.000Z");
    expect(await store.countRecentForWallet("0xAAAA111111111111111111111111111111111111", recentOnly)).toBe(1);
  });
});

describe("getClientErrorStore (unconfigured fallback)", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    resetClientErrorStoreForTests();
  });

  it("rejects countRecentForWallet with ClientErrorStoreUnavailableError rather than a false 0 (issue #393 review)", async () => {
    delete process.env.DATABASE_URL;
    resetClientErrorStoreForTests();
    const store = getClientErrorStore();
    await expect(store.countRecentForWallet("0x1111111111111111111111111111111111111111", new Date())).rejects.toThrow(
      ClientErrorStoreUnavailableError,
    );
  });
});
