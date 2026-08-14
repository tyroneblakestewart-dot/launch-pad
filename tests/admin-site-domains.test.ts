import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getPublishedSites } from "@/app/api/admin/published-sites/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  buildSubdomainRoutingHealthStage,
  resetAdminPublishedSiteDomainsAdapterForTests,
  setAdminPublishedSiteDomainsAdapterForTests,
  type PublicSiteSubdomainQuery,
} from "@/lib/server/public-site-subdomain";

const ROOT = process.cwd();
const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-site-domain-session";
const WALLET = "0x1111111111111111111111111111111111111111";
let cookie = "";

beforeEach(async () => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetAdminPublishedSiteDomainsAdapterForTests();
});

describe("GET /api/admin/published-sites", () => {
  it("requires an admin session", async () => {
    const response = await getPublishedSites(
      new Request(`${ORIGIN}/api/admin/published-sites`),
    );
    expect(response.status).toBe(401);
  });

  it("returns canonical, path and paid subdomain URLs", async () => {
    setAdminPublishedSiteDomainsAdapterForTests(async ({ page, pageSize }) => ({
      page,
      pageSize,
      total: 1,
      totalPages: 1,
      routingEnabled: true,
      items: [
        {
          slug: "goldenhour",
          name: "Golden Hour",
          ticker: "GOLD",
          visibility: "live",
          ownerWalletAddress: WALLET,
          createdAt: "2026-08-14T00:00:00.000Z",
          pathUrl: "https://hoodlums.dev/goldenhour",
          subdomainUrl: "https://goldenhour.hoodlums.dev",
          canonicalUrl: "https://goldenhour.hoodlums.dev",
          entitlementTier: "bond_pro_site",
          subdomainStatus: "active",
        },
      ],
    }));

    const response = await getPublishedSites(
      new Request(`${ORIGIN}/api/admin/published-sites?page=1&pageSize=20`, {
        headers: { Cookie: cookie },
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      routingEnabled: boolean;
      items: Array<{ canonicalUrl: string; subdomainStatus: string }>;
    };
    expect(payload.routingEnabled).toBe(true);
    expect(payload.items[0]).toMatchObject({
      canonicalUrl: "https://goldenhour.hoodlums.dev",
      subdomainStatus: "active",
    });
  });
});

describe("subdomain System Health", () => {
  function healthQuery(): PublicSiteSubdomainQuery {
    return (async (sql: string) => {
      if (sql.includes("ORDER BY updated_at DESC")) {
        return { rows: [{ slug: "goldenhour" }] };
      }
      if (sql.includes("WHERE slug = $1")) {
        return {
          rows: [
            {
              slug: "goldenhour",
              owner_wallet_address: WALLET,
              visibility: "live",
            },
          ],
        };
      }
      return { rows: [] };
    }) as PublicSiteSubdomainQuery;
  }

  it("turns green when a known slug passes parser, reserved-list and paid gate checks", async () => {
    const stage = await buildSubdomainRoutingHealthStage({
      routingEnabled: true,
      query: healthQuery(),
      accessLookup: async () => ({
        status: "ready",
        walletAddress: WALLET,
        allowed: true,
        tier: "bond_pro_site",
        permanent: true,
        paidUntil: null,
        message: "Permanent access.",
      }),
    });
    expect(stage).toMatchObject({
      id: "subdomain-routing",
      status: "green",
    });
    expect(stage.message).toContain("goldenhour.hoodlums.dev");
    expect(stage.message).toContain("reserved infrastructure names");
  });

  it("stays amber and dormant until the server activation flag is enabled", async () => {
    const stage = await buildSubdomainRoutingHealthStage({
      routingEnabled: false,
      query: healthQuery(),
      accessLookup: async () => ({
        status: "ready",
        walletAddress: WALLET,
        allowed: false,
        tier: null,
        permanent: false,
        paidUntil: null,
        message: "Path only.",
      }),
    });
    expect(stage).toMatchObject({ status: "amber" });
    expect(stage.message).toContain("HOODLUMS_SUBDOMAINS_ENABLED");
  });

  it("is wired into the Subscribers pipeline and Pages admin view", async () => {
    const healthRoute = await readFile(
      path.join(ROOT, "app", "api", "admin", "health", "pipeline", "route.ts"),
      "utf8",
    );
    const dashboard = await readFile(
      path.join(ROOT, "components", "admin-dashboard.tsx"),
      "utf8",
    );
    const domains = await readFile(
      path.join(ROOT, "components", "admin-site-domains-section.tsx"),
      "utf8",
    );

    expect(healthRoute).toContain("buildSubdomainRoutingHealthStage");
    expect(healthRoute).toContain("stages: [...subscriptions.stages, subdomainRouting]");
    expect(dashboard).toContain("<AdminSiteDomainsSection />");
    expect(domains).toContain("Canonical");
    expect(domains).toContain("Paid subdomain");
  });
});
