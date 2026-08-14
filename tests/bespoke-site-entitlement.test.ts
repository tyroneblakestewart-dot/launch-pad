import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POST } from "@/app/api/generate-site-page/route";
import {
  createUnsignedBespokeSiteAccessProof,
  type BespokeSiteAccessProof,
} from "@/lib/bespoke-site-access";
import {
  BESPOKE_SITE_UPSELL_MESSAGE,
  authoriseBespokeSiteGeneration,
  resetBespokeSiteAuthoriserForTests,
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
} from "@/lib/server/subscribers";

const PRIVATE_KEY =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
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
    ...overrides,
  };
}

function accessQuery(row: BespokeSiteAccessQueryRow) {
  return async () => ({ rows: [row] });
}

function permanentAccess(
  walletAddress: string = WALLET,
): BespokeSiteAccess {
  return {
    status: "ready",
    walletAddress: walletAddress.toLowerCase(),
    allowed: true,
    tier: "bond_pro_site",
    permanent: true,
    paidUntil: null,
    message: "Permanent Bond + Pro Site access is active.",
  };
}

async function signedProof(
  project = PROJECT,
  now = NOW,
): Promise<BespokeSiteAccessProof> {
  const { proof, message } = createUnsignedBespokeSiteAccessProof({
    walletAddress: WALLET,
    origin: ORIGIN,
    project,
    now,
  });
  const signature = await ACCOUNT.signMessage({ message });
  return { ...proof, signature };
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
  // The global generation fixture marks existing AI-pipeline tests as paid.
  // These tests reset it so they exercise the real gate or their explicit
  // route-level decision.
  resetBespokeSiteAuthoriserForTests();
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  resetBespokeSiteAuthoriserForTests();
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server subscriber source of truth", () => {
  it("records Bond + Pro Site as tier bond_pro_site and resolves permanent access years later", async () => {
    let recordedTier: string | null = null;
    const statements: string[] = [];
    const client: PlanPaymentDatabaseClient = {
      query: (async (sql: string, params?: unknown[]) => {
        statements.push(sql);
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
    expect(
      statements.some((sql) => sql.includes("SELECT paid_until, expires_at")),
    ).toBe(false);

    const access = await getBespokeSiteAccess(WALLET, {
      now: new Date("2050-01-01T00:00:00.000Z"),
      query: accessQuery(
        accessRow({
          tier: recordedTier,
          has_bond_pro_site_payment: true,
        }),
      ),
    });
    expect(access).toMatchObject({
      status: "ready",
      allowed: true,
      tier: "bond_pro_site",
      permanent: true,
      paidUntil: null,
    });
  });

  it("keeps the one-off entitlement when a later expired recurring tier overwrites the current row", async () => {
    const access = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: accessQuery(
        accessRow({
          tier: "pro",
          paid_until: "2026-01-01T00:00:00.000Z",
          has_bond_pro_site_payment: true,
        }),
      ),
    });

    expect(access).toMatchObject({
      allowed: true,
      tier: "bond_pro_site",
      permanent: true,
      paidUntil: null,
    });
  });

  it("allows an active higher tier but refuses an unpaid or expired recurring-only wallet", async () => {
    const active = await getBespokeSiteAccess(WALLET, {
      now: NOW,
      query: accessQuery(
        accessRow({
          tier: "pro_bundle",
          paid_until: "2026-12-01T00:00:00.000Z",
        }),
      ),
    });
    expect(active).toMatchObject({
      allowed: true,
      tier: "pro_bundle",
      permanent: false,
    });

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
  });

  it("fails closed as unavailable when the entitlement store cannot be reached", async () => {
    const access = await getBespokeSiteAccess(WALLET, { databaseUrl: "" });
    expect(access).toMatchObject({
      status: "unavailable",
      allowed: false,
    });
  });
});

describe("wallet-bound bespoke generation authorisation", () => {
  it("allows a paid Bond + Pro Site wallet after a valid project-bound signature", async () => {
    const proof = await signedProof();
    const lookup = vi.fn(async (walletAddress: string) =>
      permanentAccess(walletAddress),
    );

    const result = await authoriseBespokeSiteGeneration(
      {
        proof,
        project: PROJECT,
        requestOrigin: ORIGIN,
      },
      { now: NOW, accessLookup: lookup },
    );

    expect(result).toMatchObject({
      status: "allowed",
      tier: "bond_pro_site",
      permanent: true,
    });
    expect(lookup).toHaveBeenCalledWith(
      expect.stringMatching(/^0x[0-9a-f]{40}$/i),
      { now: NOW },
    );
  });

  it("rejects a tampered or expired proof before consulting subscriber access", async () => {
    const proof = await signedProof();
    const lookup = vi.fn(async () => permanentAccess());

    const tampered = await authoriseBespokeSiteGeneration(
      {
        proof,
        project: { ...PROJECT, ticker: "OTHER" },
        requestOrigin: ORIGIN,
      },
      { now: NOW, accessLookup: lookup },
    );
    expect(tampered.status).toBe("invalid-proof");
    expect(lookup).not.toHaveBeenCalled();

    const expired = await authoriseBespokeSiteGeneration(
      {
        proof,
        project: PROJECT,
        requestOrigin: ORIGIN,
      },
      {
        now: new Date("2026-08-14T12:06:00.000Z"),
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

  it("lets an eligible Bond + Pro Site decision enter the AI pipeline", async () => {
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
