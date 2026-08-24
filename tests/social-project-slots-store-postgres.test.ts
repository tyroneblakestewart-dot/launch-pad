import { afterEach, describe, expect, it, vi } from "vitest";

// Exercises createPostgresSocialProjectSlotsStore's real SQL/transaction
// shape against a fake pool/client double (issue #407), following
// tests/support-tickets-store-postgres.test.ts's pattern — proves the
// per-wallet advisory-lock serialization, the locked release-cooldown
// check, and rollback-on-error behaviour that the in-memory test helper
// can't demonstrate since it has no transaction concept.

vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: vi.fn(),
}));

import { getPostgresPool } from "@/lib/server/postgres";
import { createPostgresSocialProjectSlotsStore } from "@/lib/server/social-project-slots-store";

const WALLET = "0x1111111111111111111111111111111111111111";
const SLOT_ID = "22222222-2222-2222-2222-222222222222";

type QueryCall = { text: string; params?: unknown[] };

function slotRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SLOT_ID,
    wallet_address: WALLET,
    project_id: "proj-1",
    display_name: "Test Coin",
    registered_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createFakeClient(handler: (text: string, params: unknown[] | undefined, calls: QueryCall[]) => { rows: unknown[] } | undefined) {
  const calls: QueryCall[] = [];
  const releaseSpy = vi.fn();
  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      const result = handler(text, params, calls);
      return result ?? { rows: [] };
    }),
    release: releaseSpy,
  };
  return { client, calls, releaseSpy };
}

function installPool(client: unknown, poolQuery?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) {
  const connect = vi.fn(async () => client);
  const pool = {
    connect,
    query: vi.fn(poolQuery ?? (async () => ({ rows: [] }))),
  };
  vi.mocked(getPostgresPool).mockReturnValue(pool as unknown as ReturnType<typeof getPostgresPool>);
  return pool;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("createPostgresSocialProjectSlotsStore — ensureSlot transaction shape", () => {
  it("BEGINs, takes a per-wallet advisory lock before counting, inserts, then COMMITs", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("LIMIT 1") && text.includes("project_id = $2")) return { rows: [] };
      if (text.includes("COUNT(*)::int AS count")) return { rows: [{ count: 0 }] };
      if (text.includes("INSERT INTO social_project_slots")) return { rows: [slotRow()] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });

    expect(result.status).toBe("registered");
    const texts = calls.map((call) => call.text);
    expect(texts[0]).toBe("BEGIN");
    const lockIndex = texts.findIndex((text) => text.includes("pg_advisory_xact_lock"));
    const countIndex = texts.findIndex((text) => text.includes("COUNT(*)::int AS count"));
    const insertIndex = texts.findIndex((text) => text.includes("INSERT INTO social_project_slots"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(countIndex);
    expect(countIndex).toBeLessThan(insertIndex);
    expect(texts[texts.length - 1]).toBe("COMMIT");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the existing slot without inserting a duplicate row", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("project_id = $2") && text.includes("LIMIT 1")) return { rows: [slotRow()] };
      if (text.includes("COUNT(*)::int AS count")) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 });

    expect(result.status).toBe("existing");
    expect(calls.some((call) => call.text.includes("INSERT"))).toBe(false);
  });

  it("returns limit_reached and never inserts when the wallet is already at its plan limit", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("project_id = $2") && text.includes("LIMIT 1")) return { rows: [] };
      if (text.includes("COUNT(*)::int AS count")) return { rows: [{ count: 1 }] };
      if (text.includes("ORDER BY registered_at ASC")) return { rows: [slotRow()] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.ensureSlot({ walletAddress: WALLET, projectId: "proj-2", displayName: "Other Coin", limit: 1 });

    expect(result.status).toBe("limit_reached");
    if (result.status === "limit_reached") {
      expect(result.activeCount).toBe(1);
      expect(result.slots).toHaveLength(1);
    }
    expect(calls.some((call) => call.text.includes("INSERT"))).toBe(false);
    expect(calls[calls.length - 1].text).toBe("COMMIT");
  });

  it("rolls back, releases the client, and rethrows when the insert fails unexpectedly", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN") return { rows: [] };
      if (text.includes("project_id = $2") && text.includes("LIMIT 1")) return { rows: [] };
      if (text.includes("COUNT(*)::int AS count")) return { rows: [{ count: 0 }] };
      if (text.includes("INSERT INTO social_project_slots")) throw new Error("connection reset");
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    await expect(
      store.ensureSlot({ walletAddress: WALLET, projectId: "proj-1", displayName: "Test Coin", limit: 1 }),
    ).rejects.toThrow("connection reset");
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createPostgresSocialProjectSlotsStore — releaseByUser transaction shape", () => {
  it("locks per-wallet, checks the cooldown before the slot lookup, releases, then COMMITs", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("released_by = 'user'") && text.includes("ORDER BY released_at DESC")) return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [slotRow()] };
      if (text.includes("UPDATE social_project_slots") && text.includes("released_by = 'user'")) {
        return { rows: [{ released_at: new Date("2026-01-08T00:00:00.000Z") }] };
      }
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1" });

    expect(result.status).toBe("ok");
    const texts = calls.map((call) => call.text);
    expect(texts[0]).toBe("BEGIN");
    const cooldownIndex = texts.findIndex((text) => text.includes("released_by = 'user'") && text.includes("ORDER BY released_at DESC"));
    const lockIndex = texts.findIndex((text) => text.includes("FOR UPDATE"));
    expect(cooldownIndex).toBeGreaterThanOrEqual(0);
    expect(cooldownIndex).toBeLessThan(lockIndex);
    expect(texts[texts.length - 1]).toBe("COMMIT");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects within the seven-day cooldown and never looks up the slot to release", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("released_by = 'user'") && text.includes("ORDER BY released_at DESC")) {
        return { rows: [{ released_at: new Date("2026-01-05T00:00:00.000Z") }] };
      }
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.releaseByUser({
      walletAddress: WALLET,
      projectId: "proj-1",
      now: new Date("2026-01-08T00:00:00.000Z"),
    });

    expect(result.status).toBe("cooldown");
    if (result.status === "cooldown") {
      expect(result.nextReleaseAllowedAt).toBe("2026-01-12T00:00:00.000Z");
    }
    expect(calls.some((call) => call.text.includes("FOR UPDATE"))).toBe(false);
  });

  it("returns not_found and never updates when no active slot matches the project id", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.releaseByUser({ walletAddress: WALLET, projectId: "unknown-project" });

    expect(result.status).toBe("not_found");
    expect(calls.some((call) => call.text.includes("UPDATE social_project_slots"))).toBe(false);
  });

  it("rolls back, releases the client, and rethrows when the release UPDATE fails unexpectedly", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [slotRow()] };
      if (text.includes("UPDATE social_project_slots")) throw new Error("connection reset");
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    await expect(store.releaseByUser({ walletAddress: WALLET, projectId: "proj-1" })).rejects.toThrow("connection reset");
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createPostgresSocialProjectSlotsStore — releaseByAdmin", () => {
  it("updates released_by = 'admin' in a single atomic UPDATE, no advisory lock needed", async () => {
    let capturedText = "";
    installPool(
      { query: vi.fn(), release: vi.fn() },
      async (text: string) => {
        capturedText = text;
        return { rows: [{ id: SLOT_ID, released_at: new Date("2026-01-08T00:00:00.000Z") }] };
      },
    );

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.releaseByAdmin({ walletAddress: WALLET, projectId: "proj-1" });

    expect(result.status).toBe("ok");
    expect(capturedText).toContain("released_by = 'admin'");
    expect(capturedText).toContain("WHERE LOWER(wallet_address) = LOWER($1) AND project_id = $2 AND released_at IS NULL");
  });

  it("returns not_found when no active slot matches", async () => {
    installPool({ query: vi.fn(), release: vi.fn() }, async () => ({ rows: [] }));

    const store = createPostgresSocialProjectSlotsStore("postgres://test");
    const result = await store.releaseByAdmin({ walletAddress: WALLET, projectId: "unknown-project" });

    expect(result.status).toBe("not_found");
  });
});
