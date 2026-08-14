import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate-site-page/challenge/route";
import { GENERATE_SITE_STYLE_HEADER, resetBespokeSiteChallengeRateLimitForTests } from "@/lib/server/api-protection";
import {
  BESPOKE_SITE_UPSELL_MESSAGE,
  resetBespokeSiteChallengeIssuerForTests,
  setBespokeSiteChallengeIssuerForTests,
} from "@/lib/server/bespoke-site-entitlement";

const ORIGIN = "https://hoodlums.dev";
const SECRET = "test-generation-secret";
const WALLET = "0x1111111111111111111111111111111111111111";
const PROJECT = {
  name: "Premium Cat",
  ticker: "PCAT",
  description:
    "A complete project description used to request a paid bespoke challenge.",
  inspirationUrl: "",
};

function request(options: {
  origin?: string;
  secret?: string;
  ip?: string;
} = {}) {
  const headers = new Headers({
    "Content-Type": "application/json",
    Origin: options.origin ?? ORIGIN,
    "x-forwarded-for": options.ip ?? "203.0.113.15",
  });
  if (options.secret !== "missing") {
    headers.set(GENERATE_SITE_STYLE_HEADER, options.secret ?? SECRET);
  }
  return new Request(`${ORIGIN}/api/generate-site-page/challenge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ walletAddress: WALLET, project: PROJECT }),
  });
}

beforeEach(() => {
  process.env.GENERATE_SITE_STYLE_SHARED_SECRET = SECRET;
  process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN = ORIGIN;
  resetBespokeSiteChallengeIssuerForTests();
  resetBespokeSiteChallengeRateLimitForTests();
});

afterEach(() => {
  delete process.env.GENERATE_SITE_STYLE_SHARED_SECRET;
  delete process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN;
  resetBespokeSiteChallengeIssuerForTests();
  resetBespokeSiteChallengeRateLimitForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/generate-site-page/challenge", () => {
  it("keeps the existing shared-secret and origin protection in front of entitlement", async () => {
    const issuer = vi.fn();
    setBespokeSiteChallengeIssuerForTests(issuer);

    const missingSecret = await POST(request({ secret: "missing" }));
    expect(missingSecret.status).toBe(401);

    const wrongOrigin = await POST(
      request({ origin: "https://attacker.example" }),
    );
    expect(wrongOrigin.status).toBe(401);
    expect(issuer).not.toHaveBeenCalled();
  });

  it("returns a friendly structured checkout upsell for an unpaid wallet with zero AI calls", async () => {
    setBespokeSiteChallengeIssuerForTests(async () => ({
      status: "upsell",
      walletAddress: WALLET,
      message: BESPOKE_SITE_UPSELL_MESSAGE,
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(403);
    expect(body).toEqual({
      code: "bespoke-plan-required",
      upgradeRequired: true,
      checkoutPlan: "bond-pro-site",
      message: BESPOKE_SITE_UPSELL_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["bond_pro_site", "pro", "pro_bundle"] as const)(
    "issues a one-time wallet challenge for eligible tier %s",
    async (tier) => {
      setBespokeSiteChallengeIssuerForTests(async () => ({
        status: "issued",
        challenge: {
          challengeId: "00000000-0000-4000-8000-000000000001",
          nonce: "abcdefghijklmnopqrstuvwx12345678",
          walletAddress: WALLET,
          origin: ORIGIN,
          issuedAt: "2026-08-14T12:00:00.000Z",
          expiresAt: "2026-08-14T12:05:00.000Z",
          projectHash: `0x${"ab".repeat(32)}`,
          message: "Sign this one-time bespoke-site approval.",
          tier,
        },
      }));

      const response = await POST(request());
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(201);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toMatchObject({
        challengeId: "00000000-0000-4000-8000-000000000001",
        walletAddress: WALLET,
        tier,
      });
    },
  );

  it("rate-limits challenge issuance independently without changing the 10/hour generation limit", async () => {
    setBespokeSiteChallengeIssuerForTests(async () => ({
      status: "issued",
      challenge: {
        challengeId: "00000000-0000-4000-8000-000000000001",
        nonce: "abcdefghijklmnopqrstuvwx12345678",
        walletAddress: WALLET,
        origin: ORIGIN,
        issuedAt: "2026-08-14T12:00:00.000Z",
        expiresAt: "2026-08-14T12:05:00.000Z",
        projectHash: `0x${"ab".repeat(32)}`,
        message: "Sign this one-time bespoke-site approval.",
        tier: "bond_pro_site",
      },
    }));

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await POST(request({ ip: "198.51.100.20" }));
      expect(response.status).toBe(201);
    }
    const blocked = await POST(request({ ip: "198.51.100.20" }));
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({
      code: "bespoke-challenge-rate-limited",
    });
  });
});
