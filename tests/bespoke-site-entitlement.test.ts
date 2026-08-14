import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POST } from "@/app/api/generate-site-page/route";
import type { BespokeSiteAccessProof } from "@/lib/bespoke-site-access";
import {
  createMemoryBespokeSiteChallengeStore,
  type BespokeSiteChallengeStore,
} from "@/lib/server/bespoke-site-challenge-store";
import {
  BESPOKE_SITE_UPSELL_MESSAGE,
  authoriseBespokeSiteGeneration,
  issueBespokeSiteGenerationChallenge,
  resetBespokeSiteAuthoriserForTests,
  resetBespokeSiteChallengeIssuerForTests,
  setBespokeSiteAuthoriserForTests,
} from "@/lib/server/bespoke-site-entitlement";
import {
  persistVerifiedPlanPayment,
  type PlanPaymentDatabaseClient,
  type VerifiedChainPayment,
} from "@/lib/server/plan-payments";
import {
  getBespokeSiteAccess,
  type BespokeSiteAccess,
  type BespokeSiteAccessQueryRow,
  type BespokeSiteAccessTier,
} from "@/lib/server/subscribers";

const PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_PRIVATE_KEY =
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const OTHER_ACCOUNT = privateKeyToAccount(OTHER_PRIVATE_KEY);
const WALLET = ACCOUNT.address as Address;
const HASH = `0x${"ab".repeat(32)}` as Hash;
const ORIGIN = "https://hoodlums.dev";
const NOW = new Date("2026-08-14T12:00:00.000Z");
const PROJECT = {
  name: "Sherwood Cat",
  ticker: "SWCAT",
  description:
    "A community token with enough project detail to generate an original bespoke website.",
  inspirationUrl: "https://example.com/inspiration",
};
const VALID_IMAGE = "data:image/png;base64,aGVsbG8=";

function accessRow(
  overrides: Partial<BespokeSiteAccessQueryRow> = {},
): BespokeSiteAccessQueryRow {
  return {
    tier: null,
    paid_until: null,
    expires_at: null,
    has_bond_pro_site_payment: false,
    challenge_store_ready: true,
    ...overrides,
  };
}

function accessQuery(row: BespokeSiteAccessQueryRow) {
  return async () => ({ rows: [row] });
}

function accessFor(
  tier: BespokeSiteAccessTier,
  walletAddress: string = WALLET,
): BespokeSiteAccess {
  return {
    status: "ready",
    walletAddress: walletAddress.toLowerCase(),
    allowed: true,
    tier,
    permanent: tier === "bond_pro_site",
    paidUntil:
      tier === "bond_pro_site" ? null : "2027-01-01T00:00:00.000Z",
    message: "Eligible paid access is active.",
  };
}

async function signedOneTimeProof(input: {
  tier: BespokeSiteAccessTier;
  store: BespokeSiteChallengeStore;
  now?: Date;
  account?: typeof ACCOUNT;
  project?: typeof PROJECT;
}): Promise<{
  proof: BespokeSiteAccessProof;
  challengeId: string;
}> {
  const now = input.now ?? NOW;
  const project = input.project ?? PROJECT;
  const issued = await issueBespokeSiteGenerationChallenge(
    {
      walletAddress: WALLET,
      project,
      requestOrigin: ORIGIN,
    },
    {
      now,
      store: input.store,
      accessLookup: async (walletAddress) =>
        accessFor(input.tier, walletAddress),
    },
  );
  if (issued.status !== "issued") {
    throw new Error(`Expected challenge, received ${issued.status}`);
  }
  const signer = input.account ?? ACCOUNT;
  const signature = await signer.signMessage({
    message: issued.challenge.message,
  });
  return {
    challengeId: issued.challenge.challengeId,
    proof: {
      challengeId: issued.challenge.challengeId,
      nonce: issued.challenge.nonce,
      signature,
    },
  };
}

function routeRequest() {
  return new Request(`${ORIGIN}/api/generate-site-page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({
      ...PROJECT,
      imageDataUrl: VALID_IMAGE,
    }),
  });
}

beforeEach(() => {
  // Existing AI-pipeline suites receive a paid fixture from tests/setup.ts.
  // These focused tests reset it so the real challenge and entitlement
  // boundary, or the explicit route decision under test, is exercised.
  resetBespokeSiteAuthoriserForTests();
  resetBespokeSiteChallengeIssuerForTests();
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetBespokeSiteAuthoriserForTests();
  resetBespokeSiteChallengeIssuerForTests();
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server subscriber source of truth", () => {
  it("commits Bond + Pro Site as bond_pro_site before the same-session challenge can be issued", async () => {
    let recordedTier: string | null = null;
    let committed = false;
    const statements: string[] = [];
    const client: PlanPaymentDatabaseClient = {
      query: (async (sql: string, params?: unknown[]) => {
        statements.push(sql);
        if (sql === "COMMIT") committed = true;
        if (sql.includes("INSERT INTO plan_payment_events")) {
          return {
            rows: [{
              wallet_address: WALLET,
              plan_id: "bond-pro-site",
              billing_period: "one_off",
              asset_symbol: "ETH",
              asset_contract: null,
              paid_from: null,
              paid_until: null,
            }],
          };
        }
        if (sql.includes("INSERT INTO subscriptions")) {
          recordedTier = String(params?.[1] || "");
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }) as PlanPaymentDatabaseClient["query"],
      release() {},
    };
    const payment: VerifiedChainPayment = {
      plan: "bond-pro-site",
      billingPeriod: "one_off",
      walletAddress: WALLET,
      transactionHash: HASH,
      asset: "ETH",
      tokenAddress: null,
      amountAtomic: 1n,
      amountDisplay: "0.000000000000000001",
      amountEth: "0.000000000000000001",
      usdCents: 1_000,
      subscriptionDays: null,
      chainId: 4663,
      blockNumber: 123n,
    };

    const verification = await persistVerifiedPlanPayment(payment, {
      connect: async () => client,
      now: NOW,
    });

    expect(verification).toMatchObject({
      plan: "bond-pro-site",
      billingPeriod: "one_off",
      paidUntil: null,
      subscriptionStatus: null,
      destination: "builder",
    });
    expect(recordedTier).toBe("bond_pro_site");
    expect(committed).toBe(true);
    expect(
      statements.some((sql) => sql.includes("SELECT paid_until, expires_at")),
    ).toBe(false);

    const store = createMemoryBespokeSiteChallengeStore();
    const issued = await issueBespokeSiteGenerationChallenge(
      {
        walletAddress: WALLET,
        project: PROJECT,
        requestOrigin: ORIGIN,
      },
      {
        now: NOW,
        store,
        accessLookup: async (walletAddress) => {
          expect(committed).toBe(true);
          return accessFor("bond_pro_site", walletAddress);
        },
      },
    );
    expect(issued).toMatchObject({
      status: "issued",
      challenge: { tier: "bond_pro_site" },
    });
  });

  it("resolves one-off access years later and keeps it after an expired recurring tier overwrites the current row", async () => {
    const permanent = await getBespokeSiteAccess(WALLET, {
      now: new Date("2050-01-01T00:00:00.000Z"),
      query: accessQuery(
        accessRow({
          tier: "bond_pro_site",
          has_bond_pro_site_payment: true,
        }),
      ),
    });
    expect(permanent).toMatchObject({
      status: "ready",
      allowed: true,
      tier: "bond_pro_site",
      permanent: true,
      paidUntil: null,
    });

    const overwritten = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: accessQuery(
        accessRow({
          tier: "pro",
          paid_until: "2026-01-01T00:00:00.000Z",
          has_bond_pro_site_payment: true,
        }),
      ),
    });
    expect(overwritten).toMatchObject({
      allowed: true,
      tier: "bond_pro_site",
      permanent: true,
      paidUntil: null,
    });
  });

  it.each([
    ["pro", "2026-12-01T00:00:00.000Z"],
    ["pro_bundle", "2026-12-01T00:00:00.000Z"],
  ] as const)("allows active %s access", async (tier, paidUntil) => {
    const access = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: accessQuery(
        accessRow({ tier, paid_until: paidUntil }),
      ),
    });
    expect(access).toMatchObject({
      status: "ready",
      allowed: true,
      tier,
      permanent: false,
    });
  });

  it("refuses unpaid and expired recurring-only wallets and fails closed when the challenge store is missing", async () => {
    const expired = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: accessQuery(
        accessRow({
          tier: "pro",
          paid_until: "2026-01-01T00:00:00.000Z",
        }),
      ),
    });
    expect(expired).toMatchObject({ allowed: false, tier: null });

    const unpaid = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: accessQuery(accessRow()),
    });
    expect(unpaid).toMatchObject({
      status: "ready",
      allowed: false,
      permanent: false,
    });

    const missingMigration = await getBespokeSiteAccess(WALLET, {
      query: accessQuery(accessRow({ challenge_store_ready: false })),
    });
    expect(missingMigration).toMatchObject({
      status: "unavailable",
      allowed: false,
    });
    expect(missingMigration.message).toContain(
      "014_bespoke_site_challenges.sql",
    );
  });
});

describe("single-use wallet challenge", () => {
  it.each(["bond_pro_site", "pro", "pro_bundle"] as const)(
    "allows a valid one-time signature for %s",
    async (tier) => {
      const store = createMemoryBespokeSiteChallengeStore();
      const { proof } = await signedOneTimeProof({ tier, store });

      const result = await authoriseBespokeSiteGeneration(
        { proof, project: PROJECT, requestOrigin: ORIGIN },
        {
          now: NOW,
          store,
          accessLookup: async (walletAddress) =>
            accessFor(tier, walletAddress),
        },
      );

      expect(result).toMatchObject({
        status: "allowed",
        tier,
        permanent: tier === "bond_pro_site",
      });
    },
  );

  it("refuses replay after one successful generation authorisation", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    const { proof } = await signedOneTimeProof({
      tier: "bond_pro_site",
      store,
    });
    const lookup = vi.fn(async (walletAddress: string) =>
      accessFor("bond_pro_site", walletAddress),
    );

    const first = await authoriseBespokeSiteGeneration(
      { proof, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: lookup },
    );
    const replay = await authoriseBespokeSiteGeneration(
      { proof, project: PROJECT, requestOrigin: ORIGIN },
      { now: NOW, store, accessLookup: lookup },
    );

    expect(first.status).toBe("allowed");
    expect(replay).toMatchObject({ status: "invalid-proof" });
    if (replay.status === "invalid-proof") {
      expect(replay.message).toContain("already been used");
    }
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("refuses a forged signature and burns that one-time challenge", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    const forged = await signedOneTimeProof({
      tier: "bond_pro_site",
      store,
      account: OTHER_ACCOUNT as typeof ACCOUNT,
    });

    const rejected = await authoriseBespokeSiteGeneration(
      { proof: forged.proof, project: PROJECT, requestOrigin: ORIGIN },
      {
        now: NOW,
        store,
        accessLookup: async (walletAddress) =>
          accessFor("bond_pro_site", walletAddress),
      },
    );
    expect(rejected.status).toBe("invalid-proof");

    const issuedAgain = await issueBespokeSiteGenerationChallenge(
      { walletAddress: WALLET, project: PROJECT, requestOrigin: ORIGIN },
      {
        now: NOW,
        store,
        accessLookup: async (walletAddress) =>
          accessFor("bond_pro_site", walletAddress),
      },
    );
    expect(issuedAgain.status).toBe("issued");

    // The forged challenge itself cannot be recovered with a later correct
    // signature because it was atomically consumed before verification.
    const replayForged = await authoriseBespokeSiteGeneration(
      { proof: forged.proof, project: PROJECT, requestOrigin: ORIGIN },
      {
        now: NOW,
        store,
        accessLookup: async (walletAddress) =>
          accessFor("bond_pro_site", walletAddress),
      },
    );
    expect(replayForged).toMatchObject({ status: "invalid-proof" });
  });

  it("refuses a tampered project or an expired challenge before AI access", async () => {
    const store = createMemoryBespokeSiteChallengeStore();
    const { proof } = await signedOneTimeProof({
      tier: "bond_pro_site",
      store,
    });
    const lookup = vi.fn(async (walletAddress: string) =>
      accessFor("bond_pro_site", walletAddress),
    );

    const tampered = await authoriseBespokeSiteGeneration(
      {
        proof,
        project: { ...PROJECT, ticker: "OTHER" },
        requestOrigin: ORIGIN,
      },
      { now: NOW, store, accessLookup: lookup },
    );
    expect(tampered.status).toBe("invalid-proof");
    expect(lookup).not.toHaveBeenCalled();

    const expiredStore = createMemoryBespokeSiteChallengeStore();
    const expiredProof = await signedOneTimeProof({
      tier: "bond_pro_site",
      store: expiredStore,
    });
    const expired = await authoriseBespokeSiteGeneration(
      {
        proof: expiredProof.proof,
        project: PROJECT,
        requestOrigin: ORIGIN,
      },
      {
        now: new Date("2026-08-14T12:06:00.000Z"),
        store: expiredStore,
        accessLookup: lookup,
      },
    );
    expect(expired.status).toBe("invalid-proof");
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("POST /api/generate-site-page entitlement boundary", () => {
  it("returns a clear upsell for an unpaid wallet before making any AI request", async () => {
    setBespokeSiteAuthoriserForTests(async () => ({
      status: "upsell",
      walletAddress: WALLET,
      message: BESPOKE_SITE_UPSELL_MESSAGE,
    }));
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(routeRequest());
    const body = (await response.json()) as {
      code: string;
      upsell: boolean;
      message: string;
    };

    expect(response.status).toBe(403);
    expect(body).toEqual({
      code: "bespoke-plan-required",
      upsell: true,
      message: BESPOKE_SITE_UPSELL_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a structured proof refusal with zero AI calls", async () => {
    setBespokeSiteAuthoriserForTests(async () => ({
      status: "invalid-proof",
      message: "A fresh one-time wallet approval is required.",
    }));
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(routeRequest());
    const body = (await response.json()) as { code: string; error: string };
    expect(response.status).toBe(401);
    expect(body.code).toBe("bespoke-wallet-proof-required");
    expect(body.error).toContain("one-time wallet approval");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets an eligible paid-tier decision enter the unchanged AI pipeline", async () => {
    setBespokeSiteAuthoriserForTests(async () => ({
      status: "allowed",
      walletAddress: WALLET,
      tier: "bond_pro_site",
      permanent: true,
    }));
    process.env.OPENAI_API_KEY = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "provider unavailable" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(routeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/x-ndjson",
    );
    const stream = await response.text();
    expect(stream).toContain('"type":"error"');
    expect(fetchMock).toHaveBeenCalled();
  });
});
