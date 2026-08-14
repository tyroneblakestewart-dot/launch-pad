import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifySubdomainHost,
  publicSitePathUrl,
  publicSiteSubdomainUrl,
  subdomainRewritePath,
} from "@/lib/subdomain-routing";
import {
  decideSubdomainRequest,
  isSubdomainRoutingEnabled,
  resetPublicSiteSubdomainAccessAdapterForTests,
  resolvePublishedSiteSubdomainAccess,
  type PublicSiteSubdomainQuery,
} from "@/lib/server/public-site-subdomain";
import type { BespokeSiteAccess } from "@/lib/server/subscribers";
import { RESERVED_SLUGS } from "@/lib/slug";

const ROOT = process.cwd();
const WALLET = "0x1111111111111111111111111111111111111111";

function access(
  tier: "bond_pro_site" | "pro" | "pro_bundle" | null,
): BespokeSiteAccess {
  return {
    status: "ready",
    walletAddress: WALLET,
    allowed: Boolean(tier),
    tier,
    permanent: tier === "bond_pro_site",
    paidUntil: tier === "pro" || tier === "pro_bundle"
      ? "2027-01-01T00:00:00.000Z"
      : null,
    message: tier ? "Eligible paid access." : "No eligible entitlement.",
  };
}

function publishedSiteQuery(
  options: { slug?: string; visibility?: string; found?: boolean } = {},
): PublicSiteSubdomainQuery {
  const {
    slug = "goldenhour",
    visibility = "live",
    found = true,
  } = options;
  return vi.fn(async (sql: string) => {
    if (sql.includes("FROM published_sites") && sql.includes("WHERE slug = $1")) {
      return {
        rows: found
          ? [{ slug, owner_wallet_address: WALLET, visibility }]
          : [],
      };
    }
    return { rows: [] };
  }) as PublicSiteSubdomainQuery;
}

afterEach(() => {
  resetPublicSiteSubdomainAccessAdapterForTests();
  delete process.env.HOODLUMS_SUBDOMAINS_ENABLED;
  vi.restoreAllMocks();
});

describe("Hoodlums wildcard hostname parsing", () => {
  it("extracts one valid token label and ignores host ports/case", () => {
    expect(classifySubdomainHost("GoldenHour.HOODLUMS.dev:443")).toEqual({
      kind: "tenant",
      hostname: "goldenhour.hoodlums.dev",
      slug: "goldenhour",
    });
    expect(subdomainRewritePath("goldenhour", "/")).toBe("/goldenhour");
    expect(subdomainRewritePath("goldenhour", "/artwork")).toBe(
      "/goldenhour/artwork",
    );
  });

  it("passes the apex, localhost and Vercel previews through untouched", () => {
    for (const host of [
      "hoodlums.dev",
      "www.hoodlums.dev",
      "localhost:3000",
      "token.localhost:3000",
      "launch-pad-git-feature-team.vercel.app",
    ]) {
      expect(classifySubdomainHost(host).kind).toBe("passthrough");
    }
  });

  it("refuses reserved and multi-label Hoodlums hosts", () => {
    expect(classifySubdomainHost("admin.hoodlums.dev")).toMatchObject({
      kind: "reserved",
      slug: "admin",
    });
    expect(classifySubdomainHost("one.two.hoodlums.dev")).toMatchObject({
      kind: "invalid",
    });
  });

  it("uses one shared reserved list for routes and infrastructure names", () => {
    const required = [
      "www",
      "api",
      "admin",
      "app",
      "mail",
      "staging",
      "dev",
      "docs",
      "status",
      "cdn",
      "assets",
      "account",
      "allocations",
      "bonding-curve",
      "hoodchat",
      "liquidity-lab",
      "manager",
      "monad",
      "providers",
      "social",
      "testnet",
      "token",
    ];
    for (const name of required) expect(RESERVED_SLUGS.has(name)).toBe(true);
  });
});

describe("server-only subdomain entitlement", () => {
  it.each(["bond_pro_site", "pro", "pro_bundle"] as const)(
    "allows an entitled %s wallet",
    async (tier) => {
      const resolved = await resolvePublishedSiteSubdomainAccess("goldenhour", {
        query: publishedSiteQuery(),
        accessLookup: async () => access(tier),
      });
      expect(resolved).toMatchObject({ status: "entitled", tier });
    },
  );

  it("keeps a free published site path-only", async () => {
    const resolved = await resolvePublishedSiteSubdomainAccess("goldenhour", {
      query: publishedSiteQuery(),
      accessLookup: async () => access(null),
    });
    expect(resolved).toMatchObject({
      status: "path-only",
      ownerWalletAddress: WALLET,
    });
  });

  it("does not expose drafts or fail open when the store is unavailable", async () => {
    const draft = await resolvePublishedSiteSubdomainAccess("goldenhour", {
      query: publishedSiteQuery({ visibility: "draft" }),
      accessLookup: async () => access("bond_pro_site"),
    });
    expect(draft.status).toBe("not-found");

    const unavailable = await resolvePublishedSiteSubdomainAccess("goldenhour", {
      databaseUrl: "",
    });
    expect(unavailable.status).toBe("unavailable");
  });
});

describe("Proxy decision boundary", () => {
  it("rewrites paid page and artwork requests into the existing slug routes", async () => {
    const query = publishedSiteQuery();
    const deps = {
      routingEnabled: true,
      query,
      accessLookup: async () => access("bond_pro_site"),
    };

    await expect(
      decideSubdomainRequest(
        { host: "goldenhour.hoodlums.dev", pathname: "/" },
        deps,
      ),
    ).resolves.toEqual({
      kind: "rewrite",
      slug: "goldenhour",
      pathname: "/goldenhour",
    });
    await expect(
      decideSubdomainRequest(
        { host: "goldenhour.hoodlums.dev", pathname: "/artwork" },
        deps,
      ),
    ).resolves.toEqual({
      kind: "rewrite",
      slug: "goldenhour",
      pathname: "/goldenhour/artwork",
    });
  });

  it("rewrites an unknown valid subdomain so /[slug] produces its existing 404", async () => {
    const decision = await decideSubdomainRequest(
      { host: "unknown-token.hoodlums.dev", pathname: "/" },
      {
        routingEnabled: true,
        query: publishedSiteQuery({ found: false }),
        accessLookup: async () => access(null),
      },
    );
    expect(decision).toEqual({
      kind: "rewrite",
      slug: "unknown-token",
      pathname: "/unknown-token",
    });
  });

  it("returns the honest upgrade state for a free site's subdomain", async () => {
    const decision = await decideSubdomainRequest(
      { host: "goldenhour.hoodlums.dev", pathname: "/" },
      {
        routingEnabled: true,
        query: publishedSiteQuery(),
        accessLookup: async () => access(null),
      },
    );
    expect(decision).toEqual({
      kind: "upgrade-required",
      slug: "goldenhour",
      pathUrl: publicSitePathUrl("goldenhour"),
      message: expect.stringContaining("Bond + Pro Site"),
    });
  });

  it("never queries entitlement for reserved, preview or dormant hosts", async () => {
    const query = vi.fn() as unknown as PublicSiteSubdomainQuery;
    await expect(
      decideSubdomainRequest(
        { host: "api.hoodlums.dev", pathname: "/" },
        { routingEnabled: true, query },
      ),
    ).resolves.toMatchObject({ kind: "not-found", reason: "reserved" });
    await expect(
      decideSubdomainRequest(
        { host: "branch-preview.vercel.app", pathname: "/" },
        { routingEnabled: true, query },
      ),
    ).resolves.toEqual({ kind: "next" });
    await expect(
      decideSubdomainRequest(
        { host: "goldenhour.hoodlums.dev", pathname: "/" },
        { routingEnabled: false, query },
      ),
    ).resolves.toMatchObject({ kind: "not-found", reason: "disabled" });
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps the server-side activation flag exact and safe by default", () => {
    expect(isSubdomainRoutingEnabled({})).toBe(false);
    expect(isSubdomainRoutingEnabled({ HOODLUMS_SUBDOMAINS_ENABLED: "false" })).toBe(false);
    expect(isSubdomainRoutingEnabled({ HOODLUMS_SUBDOMAINS_ENABLED: "true" })).toBe(true);
  });

  it("wires Next 16 Proxy to the tested decision and rewrite helpers", async () => {
    const source = await readFile(path.join(ROOT, "proxy.ts"), "utf8");
    expect(source).toContain("decideSubdomainRequest");
    expect(source).toContain("NextResponse.rewrite");
    expect(source).toContain("SUBDOMAIN_REWRITE_HEADER");
    expect(source).toContain("upgrade-required");
  });

  it("builds stable public URLs", () => {
    expect(publicSitePathUrl("goldenhour")).toBe(
      "https://hoodlums.dev/goldenhour",
    );
    expect(publicSiteSubdomainUrl("goldenhour")).toBe(
      "https://goldenhour.hoodlums.dev",
    );
  });
});
