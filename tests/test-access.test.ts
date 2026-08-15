import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createMemoryBespokeSiteChallengeStore } from "@/lib/server/bespoke-site-challenge-store";
import {
  authoriseBespokeSiteGeneration,
  issueBespokeSiteGenerationChallenge,
  resetBespokeSiteAuthoriserForTests,
  resetBespokeSiteChallengeIssuerForTests,
} from "@/lib/server/bespoke-site-entitlement";
import { getBespokeSiteAccess } from "@/lib/server/subscribers";
import {
  getSubscriptionAccess,
  type SubscriptionQuery,
} from "@/lib/server/subscription-lifecycle";
import {
  TestAccessWalletAlreadyExistsError,
  addTestAccessWallet,
  buildTestAccessHealthStage,
  createMemoryTestAccessStore,
  isTestAccessWallet,
  listTestAccessWallets,
  resetTestAccessStoreForTests,
  revokeTestAccessWallet,
  setTestAccessStoreForTests,
} from "@/lib/server/test-access";

const ROOT = process.cwd();
const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const UPPER_WALLET = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
const PAID_WALLET = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-08-15T10:00:00.000Z");
const TEST_ACCOUNT = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const TEST_ORIGIN = "https://hoodlums.dev";
const TEST_PROJECT = {
  name: "Allowlist Cat",
  ticker: "TEST",
  description:
    "A wallet-signed test project proving that an admin allowlist grants bespoke access without a payment.",
  inspirationUrl: "",
};

function bespokeRow(overrides: Record<string, unknown> = {}) {
  return {
    tier: null,
    paid_until: null,
    expires_at: null,
    has_bond_pro_site_payment: false,
    challenge_store_ready: true,
    ...overrides,
  };
}

beforeEach(() => {
  // tests/setup.ts supplies a paid authoriser for unrelated AI-pipeline tests.
  // These tests exercise the real allowlist and one-use challenge boundary.
  resetBespokeSiteAuthoriserForTests();
  resetBespokeSiteChallengeIssuerForTests();
});

afterEach(() => {
  resetTestAccessStoreForTests();
  resetBespokeSiteAuthoriserForTests();
  resetBespokeSiteChallengeIssuerForTests();
});

describe("migration 015 test-access audit store", () => {
  it("enforces lowercase unique wallets and timestamped revocation without deletes", async () => {
    const migration = await readFile(
      path.join(ROOT, "db", "migrations", "015_test_access_allowlist.sql"),
      "utf8",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS test_access_wallets");
    expect(migration).toContain("wallet_address VARCHAR(42) NOT NULL");
    expect(migration).toContain("revoked_at TIMESTAMPTZ");
    expect(migration).toContain("CHECK (wallet_address = LOWER(wallet_address))");
    expect(migration).toContain("UNIQUE (wallet_address)");
    expect(migration).toContain("WHERE revoked_at IS NULL");
    expect(migration).not.toMatch(/DELETE\s+FROM\s+test_access_wallets/i);
  });
});

describe("server test-access store", () => {
  it("normalises address case, grants while active, and retains a revoked audit row", async () => {
    const store = createMemoryTestAccessStore();
    setTestAccessStoreForTests(store);

    const added = await addTestAccessWallet(
      { walletAddress: UPPER_WALLET, label: "  Tyrone   iPhone test wallet  " },
      { now: NOW },
    );
    expect(added).toMatchObject({
      walletAddress: WALLET,
      label: "Tyrone iPhone test wallet",
      active: true,
      revokedAt: null,
    });
    await expect(isTestAccessWallet(WALLET)).resolves.toBe(true);
    await expect(isTestAccessWallet(UPPER_WALLET)).resolves.toBe(true);

    const revoked = await revokeTestAccessWallet(added.id, {
      now: new Date("2026-08-15T11:00:00.000Z"),
    });
    expect(revoked.active).toBe(false);
    expect(revoked.revokedAt).toBe("2026-08-15T11:00:00.000Z");
    await expect(isTestAccessWallet(WALLET)).resolves.toBe(false);

    const listed = await listTestAccessWallets();
    expect(listed).toEqual([revoked]);
  });

  it("does not erase a revoked row by re-adding the same wallet", async () => {
    const store = createMemoryTestAccessStore();
    setTestAccessStoreForTests(store);
    const added = await addTestAccessWallet(
      { walletAddress: WALLET, label: "First test" },
      { now: NOW },
    );
    await revokeTestAccessWallet(added.id, {
      now: new Date("2026-08-15T11:00:00.000Z"),
    });

    await expect(
      addTestAccessWallet(
        { walletAddress: WALLET, label: "Second test" },
        { now: new Date("2026-08-15T12:00:00.000Z") },
      ),
    ).rejects.toBeInstanceOf(TestAccessWalletAlreadyExistsError);
    expect(await listTestAccessWallets()).toHaveLength(1);
  });

  it("fails closed for invalid, missing and non-allowlisted wallets", async () => {
    const store = createMemoryTestAccessStore();
    setTestAccessStoreForTests(store);
    await expect(isTestAccessWallet("not-a-wallet")).resolves.toBe(false);
    await expect(isTestAccessWallet(PAID_WALLET)).resolves.toBe(false);
  });
});

describe("shared paid-feature entitlement seams", () => {
  it("unlocks the shared Pro gate with an explicit test-allowlist source", async () => {
    const store = createMemoryTestAccessStore();
    setTestAccessStoreForTests(store);
    await addTestAccessWallet(
      { walletAddress: WALLET, label: "Manager and social test" },
      { now: NOW },
    );
    const paidQuery = (async () => {
      throw new Error("A paid subscription lookup should not be needed.");
    }) as SubscriptionQuery;

    await expect(
      getSubscriptionAccess(WALLET, { query: paidQuery, now: NOW }),
    ).resolves.toMatchObject({
      walletAddress: WALLET,
      plan: null,
      status: "active",
      active: true,
      accessSource: "test-allowlist",
      paidFrom: null,
      paidUntil: null,
    });
  });

  it("unlocks bespoke and Bond + Pro Site entitlements for an active test wallet", async () => {
    const store = createMemoryTestAccessStore();
    setTestAccessStoreForTests(store);
    await addTestAccessWallet(
      { walletAddress: WALLET, label: "Bespoke AI test" },
      { now: NOW },
    );

    const access = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: async () => ({ rows: [bespokeRow()] }),
    });
    expect(access).toMatchObject({
      status: "ready",
      allowed: true,
      tier: "test_access",
      accessSource: "test-allowlist",
      permanent: true,
      paidUntil: null,
    });
    expect(access.message).toContain("No payment was recorded");
  });

  it("authorises the real one-use bespoke wallet challenge without recording a payment", async () => {
    const allowlist = createMemoryTestAccessStore();
    setTestAccessStoreForTests(allowlist);
    await addTestAccessWallet({
      walletAddress: TEST_ACCOUNT.address,
      label: "Wallet-signed bespoke test",
    });
    const challengeStore = createMemoryBespokeSiteChallengeStore();

    const issued = await issueBespokeSiteGenerationChallenge(
      {
        walletAddress: TEST_ACCOUNT.address,
        project: TEST_PROJECT,
        requestOrigin: TEST_ORIGIN,
      },
      { now: NOW, store: challengeStore },
    );
    if (issued.status !== "issued") {
      throw new Error(`Expected a challenge, received ${issued.status}.`);
    }
    expect(issued.challenge).toMatchObject({
      tier: "test_access",
      accessSource: "test-allowlist",
    });

    const signature = await TEST_ACCOUNT.signMessage({
      message: issued.challenge.message,
    });
    const authorised = await authoriseBespokeSiteGeneration(
      {
        proof: {
          challengeId: issued.challenge.challengeId,
          nonce: issued.challenge.nonce,
          signature,
        },
        project: TEST_PROJECT,
        requestOrigin: TEST_ORIGIN,
      },
      { now: NOW, store: challengeStore },
    );

    expect(authorised).toMatchObject({
      status: "allowed",
      walletAddress: TEST_ACCOUNT.address.toLowerCase(),
      tier: "test_access",
      accessSource: "test-allowlist",
      permanent: true,
    });
  });

  it("revoked and non-allowlisted wallets remain blocked", async () => {
    const store = createMemoryTestAccessStore();
    setTestAccessStoreForTests(store);
    const added = await addTestAccessWallet(
      { walletAddress: WALLET, label: "Temporary test" },
      { now: NOW },
    );
    await revokeTestAccessWallet(added.id, {
      now: new Date("2026-08-15T11:00:00.000Z"),
    });

    const revoked = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: async () => ({ rows: [bespokeRow()] }),
    });
    const unknown = await getBespokeSiteAccess(PAID_WALLET, {
      now: NOW,
      query: async () => ({ rows: [bespokeRow()] }),
    });

    expect(revoked).toMatchObject({
      allowed: false,
      tier: null,
      accessSource: "none",
    });
    expect(unknown).toMatchObject({
      allowed: false,
      tier: null,
      accessSource: "none",
    });
  });

  it("leaves a genuine paid subscription unchanged", async () => {
    setTestAccessStoreForTests(createMemoryTestAccessStore());
    const query = (async (sql: string) => {
      if (sql.includes("FROM subscriptions")) {
        return {
          rows: [{
            wallet_address: PAID_WALLET,
            tier: "pro",
            paid_from: "2026-08-01T00:00:00.000Z",
            paid_until: "2026-09-02T00:00:00.000Z",
            expires_at: null,
            telegram_chat_id: null,
          }],
        };
      }
      return { rows: [{ active: false }] };
    }) as SubscriptionQuery;

    await expect(
      getSubscriptionAccess(PAID_WALLET, { query, now: NOW }),
    ).resolves.toMatchObject({
      plan: "pro",
      active: true,
      accessSource: "paid",
      paidUntil: "2026-09-02T00:00:00.000Z",
    });
  });
});

describe("admin health and honest money separation", () => {
  it("reports the allowlist separately from payment revenue", async () => {
    const store = createMemoryTestAccessStore();
    setTestAccessStoreForTests(store);
    await addTestAccessWallet(
      { walletAddress: WALLET, label: "Health test" },
      { now: NOW },
    );

    const stage = await buildTestAccessHealthStage();
    expect(stage).toMatchObject({
      id: "test-access-allowlist",
      status: "green",
    });
    expect(stage.message).toContain("1 active test wallet");
    expect(stage.message).toContain("No payment or revenue event");
  });

  it("keeps Money totals sourced only from verified plan payment events", async () => {
    const moneySource = await readFile(
      path.join(ROOT, "lib", "server", "admin-operations.ts"),
      "utf8",
    );
    const allowlistSource = await readFile(
      path.join(ROOT, "lib", "server", "test-access.ts"),
      "utf8",
    );

    expect(moneySource.match(/FROM plan_payment_events/g)).toHaveLength(2);
    expect(moneySource).not.toContain("test_access_wallets");
    expect(allowlistSource).not.toContain("plan_payment_events");
    expect(allowlistSource).not.toContain("persistVerifiedPlanPayment");
  });
});
