import { afterEach, describe, expect, it, vi } from "vitest";

// Google sign-in accounts store (phase 1, 6 Sep 2026): the unconfigured
// fallback contract, the client-facing projection, and the Postgres store's
// SQL shape against a fake pool (unique-violation → wallet_taken, cast reused
// timestamp params per the issue #386 lesson, sessions joined with expiry).

vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: vi.fn(),
}));

import { getPostgresPool } from "@/lib/server/postgres";
import {
  UserAccountsStoreUnavailableError,
  createPostgresUserAccountsStore,
  getUserAccountsStore,
  resetUserAccountsStoreForTests,
  setUserAccountsStoreForTests,
  toAccountSummary,
} from "@/lib/server/user-accounts-store";
import { createMemoryUserAccountsStore } from "./user-accounts-test-helpers";

const ACCOUNT_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  google_sub: "sub-1",
  email: "a@b.c",
  email_verified: true,
  display_name: "A",
  linked_wallet_address: null,
  wallet_linked_at: null,
  last_sign_in_at: new Date("2026-09-06T10:00:00.000Z"),
  created_at: new Date("2026-09-01T00:00:00.000Z"),
  updated_at: new Date("2026-09-06T10:00:00.000Z"),
};

type Call = { text: string; params?: unknown[] };

function installPool(handler: (text: string, params?: unknown[]) => { rows: unknown[] } | Error) {
  const calls: Call[] = [];
  const pool = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      const result = handler(text, params);
      if (result instanceof Error) throw result;
      return result;
    }),
  };
  vi.mocked(getPostgresPool).mockReturnValue(pool as never);
  return { calls };
}

afterEach(() => {
  resetUserAccountsStoreForTests();
  delete process.env.DATABASE_URL;
  vi.mocked(getPostgresPool).mockReset();
});

describe("unconfigured UserAccountsStore", () => {
  it("reads as empty and refuses writes without DATABASE_URL", async () => {
    const store = getUserAccountsStore();
    expect(await store.getById("x")).toBeNull();
    expect(await store.findByWallet("0x1")).toBeNull();
    expect(await store.getSessionAccount("h")).toBeNull();
    expect(await store.listForAdmin(10)).toEqual([]);
    expect(await store.counts()).toEqual({ accounts: 0, linked: 0, signedIn7d: 0 });
    expect(await store.tableExists()).toBe(false);
    await expect(store.upsertGoogleAccount({ googleSub: "s", email: "e", emailVerified: true, displayName: "" })).rejects.toBeInstanceOf(UserAccountsStoreUnavailableError);
    await expect(store.linkWallet("a", "0x1")).rejects.toBeInstanceOf(UserAccountsStoreUnavailableError);
    await expect(store.createSession("a", "h", new Date())).rejects.toBeInstanceOf(UserAccountsStoreUnavailableError);
    await expect(store.deleteAccount("a")).rejects.toBeInstanceOf(UserAccountsStoreUnavailableError);
    // Logout must still succeed without storage — the cookie is what matters.
    await expect(store.destroySession("h")).resolves.toBeUndefined();
  });

  it("prefers the injected test store", async () => {
    const memory = createMemoryUserAccountsStore();
    setUserAccountsStoreForTests(memory);
    expect(getUserAccountsStore()).toBe(memory);
  });
});

describe("toAccountSummary", () => {
  it("exposes email and link state only — never the Google id or internal ids", () => {
    const summary = toAccountSummary({
      id: "id",
      googleSub: "sub",
      email: "a@b.c",
      emailVerified: true,
      displayName: "A",
      linkedWalletAddress: "0xabc",
      walletLinkedAt: "2026-09-06T00:00:00.000Z",
      lastSignInAt: "x",
      createdAt: "x",
      updatedAt: "x",
    });
    expect(summary).toEqual({ email: "a@b.c", emailVerified: true, displayName: "A", linkedWalletAddress: "0xabc", walletLinkedAt: "2026-09-06T00:00:00.000Z" });
    expect(JSON.stringify(summary)).not.toContain("sub");
  });
});

describe("memory test helper contract", () => {
  it("enforces one account per wallet and cascades sessions on delete", async () => {
    const store = createMemoryUserAccountsStore();
    const a = await store.upsertGoogleAccount({ googleSub: "a", email: "a@x.y", emailVerified: true, displayName: "" });
    const b = await store.upsertGoogleAccount({ googleSub: "b", email: "b@x.y", emailVerified: true, displayName: "" });
    expect((await store.linkWallet(a.id, "0xABC")).status).toBe("linked");
    expect((await store.linkWallet(b.id, "0xabc")).status).toBe("wallet_taken");
    expect((await store.findByWallet("0xabc"))?.id).toBe(a.id);
    await store.createSession(a.id, "hash", new Date(Date.now() + 60_000));
    expect((await store.getSessionAccount("hash"))?.id).toBe(a.id);
    await store.deleteAccount(a.id);
    expect(await store.getSessionAccount("hash")).toBeNull();
    expect(await store.counts()).toEqual({ accounts: 1, linked: 0, signedIn7d: 1 });
  });
});

describe("createPostgresUserAccountsStore", () => {
  it("upserts on google_sub, refreshing email/name/last_sign_in_at and casting the timestamp param", async () => {
    const { calls } = installPool(() => ({ rows: [ACCOUNT_ROW] }));
    const store = createPostgresUserAccountsStore("postgres://x");
    const now = new Date("2026-09-06T10:00:00.000Z");
    const account = await store.upsertGoogleAccount({ googleSub: "sub-1", email: "a@b.c", emailVerified: true, displayName: "A" }, now);
    expect(calls[0].text).toContain("ON CONFLICT (google_sub) DO UPDATE SET");
    expect(calls[0].text).toContain("last_sign_in_at = EXCLUDED.last_sign_in_at");
    expect(calls[0].text).toContain("$5::timestamptz");
    expect(calls[0].params).toEqual(["sub-1", "a@b.c", true, "A", now]);
    expect(account).toMatchObject({ id: ACCOUNT_ROW.id, googleSub: "sub-1", email: "a@b.c", linkedWalletAddress: null, walletLinkedAt: null });
    expect(account.lastSignInAt).toBe("2026-09-06T10:00:00.000Z");
  });

  it("maps a 23505 unique violation on the wallet index to wallet_taken and rethrows anything else", async () => {
    const unique = Object.assign(new Error("duplicate key"), { code: "23505" });
    installPool(() => unique);
    const store = createPostgresUserAccountsStore("postgres://x");
    expect(await store.linkWallet("acct", "0xabc")).toEqual({ status: "wallet_taken" });

    installPool(() => Object.assign(new Error("boom"), { code: "XX000" }));
    await expect(createPostgresUserAccountsStore("postgres://y").linkWallet("acct", "0xabc")).rejects.toThrow("boom");
  });

  it("reports account_not_found when the UPDATE touches no row, and linked with the row otherwise", async () => {
    let rows: unknown[] = [];
    const { calls } = installPool(() => ({ rows }));
    const store = createPostgresUserAccountsStore("postgres://x");
    expect(await store.linkWallet("missing", "0xabc")).toEqual({ status: "account_not_found" });
    expect(calls[0].text).toContain("$3::timestamptz");

    rows = [{ ...ACCOUNT_ROW, linked_wallet_address: "0xabc", wallet_linked_at: new Date("2026-09-06T11:00:00.000Z") }];
    const linked = await store.linkWallet(ACCOUNT_ROW.id, "0xabc");
    expect(linked.status).toBe("linked");
    if (linked.status === "linked") expect(linked.account.walletLinkedAt).toBe("2026-09-06T11:00:00.000Z");
  });

  it("reads a session by joining user_sessions to user_accounts with an expiry guard", async () => {
    const { calls } = installPool(() => ({ rows: [ACCOUNT_ROW] }));
    const store = createPostgresUserAccountsStore("postgres://x");
    const now = new Date("2026-09-06T12:00:00.000Z");
    expect((await store.getSessionAccount("hash", now))?.id).toBe(ACCOUNT_ROW.id);
    expect(calls[0].text).toContain("FROM user_sessions s");
    expect(calls[0].text).toContain("JOIN user_accounts a ON a.id = s.account_id");
    expect(calls[0].text).toContain("s.expires_at > $2::timestamptz");
    expect(calls[0].params).toEqual(["hash", now]);
  });

  it("matches wallets case-insensitively and bounds the admin list", async () => {
    const { calls } = installPool(() => ({ rows: [] }));
    const store = createPostgresUserAccountsStore("postgres://x");
    await store.findByWallet("0xABC");
    expect(calls[0].text).toContain("LOWER(linked_wallet_address) = LOWER($1)");
    await store.listForAdmin(10_000);
    expect(calls[1].params).toEqual([500]);
    await store.listForAdmin(0);
    expect(calls[2].params).toEqual([1]);
  });

  it("counts total / linked / signed-in-7d in one query and checks both tables exist", async () => {
    const { calls } = installPool((text) =>
      text.includes("information_schema")
        ? { rows: [{ table_name: "user_accounts" }, { table_name: "user_sessions" }] }
        : { rows: [{ accounts: "3", linked: "1", signed_in_7d: 2 }] },
    );
    const store = createPostgresUserAccountsStore("postgres://x");
    expect(await store.counts(new Date("2026-09-06T12:00:00.000Z"))).toEqual({ accounts: 3, linked: 1, signedIn7d: 2 });
    expect(calls[0].text).toContain("$1::timestamptz - INTERVAL '7 days'");
    expect(await store.tableExists()).toBe(true);

    installPool(() => ({ rows: [{ table_name: "user_accounts" }] }));
    expect(await createPostgresUserAccountsStore("postgres://y").tableExists()).toBe(false);
  });
});
