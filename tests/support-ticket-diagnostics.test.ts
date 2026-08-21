import { afterEach, describe, expect, it } from "vitest";
import { buildSupportTicketDiagnostics } from "@/lib/server/support-ticket-diagnostics";
import {
  resetClientErrorStoreForTests,
  setClientErrorStoreForTests,
} from "@/lib/server/client-errors-store";
import {
  resetSocialConnectionsStoreForTests,
  setSocialConnectionsStoreForTests,
} from "@/lib/server/social-connections-store";
import { createMemorySocialConnectionsStore } from "./social-connections-test-helpers";

const WALLET = "0x1111111111111111111111111111111111111111";

function fakeQuery(rows: Array<Record<string, unknown>>) {
  return async () => ({ rows });
}

afterEach(() => {
  resetSocialConnectionsStoreForTests();
  resetClientErrorStoreForTests();
});

describe("buildSupportTicketDiagnostics", () => {
  it("reports plan unavailable when no database and no query override are supplied", async () => {
    const diagnostics = await buildSupportTicketDiagnostics(WALLET, { databaseUrl: "" });
    expect(diagnostics.plan).toEqual({ status: "unavailable" });
  });

  it("reports plan unavailable, not a false 'no plan', when the query itself fails", async () => {
    const diagnostics = await buildSupportTicketDiagnostics(WALLET, {
      query: async () => {
        throw new Error("connection reset");
      },
    });
    expect(diagnostics.plan).toEqual({ status: "unavailable" });
  });

  it("reports the checked plan for an active subscription row", async () => {
    const diagnostics = await buildSupportTicketDiagnostics(WALLET, {
      now: new Date("2026-06-01T00:00:00.000Z"),
      query: fakeQuery([
        {
          wallet_address: WALLET,
          tier: "pro",
          paid_from: "2026-01-01T00:00:00.000Z",
          paid_until: "2027-01-01T00:00:00.000Z",
          expires_at: null,
          telegram_chat_id: null,
        },
      ]),
    });
    expect(diagnostics.plan).toEqual({
      status: "checked",
      plan: "pro",
      subscriptionStatus: "active",
      active: true,
      accessSource: "paid",
    });
  });

  it("reports the checked plan (inactive) for a wallet with no subscription row", async () => {
    const diagnostics = await buildSupportTicketDiagnostics(WALLET, { query: fakeQuery([]) });
    expect(diagnostics.plan).toEqual({
      status: "checked",
      plan: null,
      subscriptionStatus: "expired",
      active: false,
      accessSource: "none",
    });
  });

  it("includes social connection platform+status only, never credentials", async () => {
    const store = createMemorySocialConnectionsStore();
    await store.upsert({ walletAddress: WALLET, platform: "telegram", displayName: "@chan", externalId: "1", credentials: "super-secret-token" });
    setSocialConnectionsStoreForTests(store);

    const diagnostics = await buildSupportTicketDiagnostics(WALLET, { query: fakeQuery([]) });
    expect(diagnostics.socialConnections).toEqual([{ platform: "telegram", status: "connected" }]);
    expect(JSON.stringify(diagnostics)).not.toContain("super-secret-token");
  });

  it("degrades safely to an empty connections list when the connections store throws", async () => {
    setSocialConnectionsStoreForTests({
      async get() {
        throw new Error("db down");
      },
      async list() {
        throw new Error("db down");
      },
      async upsert() {
        throw new Error("db down");
      },
      async getCredentials() {
        throw new Error("db down");
      },
      async markReconnectNeeded() {},
      async recordFailure() {},
      async resetFailures() {},
      async delete() {},
      async createXOAuthRequest() {},
      async consumeXOAuthRequest() {
        return { status: "not_found" };
      },
    });

    const diagnostics = await buildSupportTicketDiagnostics(WALLET, { query: fakeQuery([]) });
    expect(diagnostics.socialConnections).toEqual([]);
  });

  it("includes a recent client-error count when the store can query by wallet", async () => {
    const store = createMemorySocialConnectionsStore();
    setSocialConnectionsStoreForTests(store);

    const now = new Date("2026-06-01T00:00:00.000Z");
    const errorStore = {
      async recordError(input: { walletAddress: string | null }) {
        void input;
      },
      async listGroups() {
        return { status: "ready" as const, message: "ok", groups: [] };
      },
      async resolveGroup() {
        return "resolved" as const;
      },
      async countNewGroupsSince() {
        return 0;
      },
      async countRecentForWallet(walletAddress: string) {
        return walletAddress.toLowerCase() === WALLET.toLowerCase() ? 3 : 0;
      },
    };
    setClientErrorStoreForTests(errorStore);

    const diagnostics = await buildSupportTicketDiagnostics(WALLET, { now, query: fakeQuery([]) });
    expect(diagnostics.recentClientErrorCount).toBe(3);
  });

  it("reports null (not a false 0) through the real unconfigured client-error store singleton (issue #393 review)", async () => {
    resetClientErrorStoreForTests();
    const originalDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const diagnostics = await buildSupportTicketDiagnostics(WALLET, { query: fakeQuery([]) });
      expect(diagnostics.recentClientErrorCount).toBeNull();
    } finally {
      if (originalDatabaseUrl !== undefined) process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("degrades safely to null when the crash-report store cannot be queried", async () => {
    setClientErrorStoreForTests({
      async recordError() {},
      async listGroups() {
        return { status: "unavailable" as const, message: "unavailable", groups: [] };
      },
      async resolveGroup() {
        return "not_found" as const;
      },
      async countNewGroupsSince() {
        return 0;
      },
      async countRecentForWallet() {
        throw new Error("db down");
      },
    });
    const diagnostics = await buildSupportTicketDiagnostics(WALLET, { query: fakeQuery([]) });
    expect(diagnostics.recentClientErrorCount).toBeNull();
  });
});
