import type { AdminPipelineStage } from "@/lib/admin-operations";
import {
  classifySubdomainHost,
  isSubdomainPlatformAssetPath,
  publicSitePathUrl,
  publicSiteSubdomainUrl,
  subdomainRewritePath,
} from "@/lib/subdomain-routing";
import { getPostgresPool } from "@/lib/server/postgres";
import {
  getBespokeSiteAccess,
  type BespokeSiteAccess,
  type BespokeSiteAccessQuery,
  type GetBespokeSiteAccessDeps,
} from "@/lib/server/subscribers";
import {
  HEALTH_CHECK_TIMEOUT_MS,
  withTimeout,
} from "@/lib/server/system-health";
import { RESERVED_SLUGS, validateSlug } from "@/lib/slug";

export const SUBDOMAIN_ROUTING_ENABLED_ENV = "HOODLUMS_SUBDOMAINS_ENABLED";

export type PublicSiteSubdomainQuery = <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  text: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

type PublishedSiteOwnerRow = {
  slug: string;
  owner_wallet_address: string;
  visibility: string;
};

type AdminPublishedSiteRow = PublishedSiteOwnerRow & {
  token_name: string;
  ticker: string;
  created_at: Date | string;
  total_count: number | string;
};

export type PublicSiteSubdomainAccess =
  | {
      status: "entitled";
      slug: string;
      ownerWalletAddress: string;
      tier: NonNullable<BespokeSiteAccess["tier"]>;
      permanent: boolean;
    }
  | {
      status: "path-only";
      slug: string;
      ownerWalletAddress: string;
    }
  | { status: "not-found"; slug: string }
  | { status: "unavailable"; slug: string; message: string };

export type PublicSiteCanonicalUrls = {
  pageUrl: string;
  artworkUrl: string;
  subdomainEligible: boolean;
  subdomainActive: boolean;
};

export type PublicSiteSubdomainDeps = {
  databaseUrl?: string;
  query?: PublicSiteSubdomainQuery;
  accessLookup?: typeof getBespokeSiteAccess;
  now?: Date;
  routingEnabled?: boolean;
};

export type SubdomainRequestDecision =
  | { kind: "next" }
  | { kind: "rewrite"; slug: string; pathname: string }
  | {
      kind: "upgrade-required";
      slug: string;
      pathUrl: string;
      message: string;
    }
  | {
      kind: "not-found";
      reason: "reserved" | "invalid" | "disabled" | "unsupported";
      slug: string | null;
    }
  | { kind: "unavailable"; message: string };

export type AdminPublishedSiteDomainItem = {
  slug: string;
  name: string;
  ticker: string;
  visibility: string;
  ownerWalletAddress: string;
  createdAt: string;
  pathUrl: string;
  subdomainUrl: string | null;
  canonicalUrl: string;
  entitlementTier: BespokeSiteAccess["tier"];
  subdomainStatus: "active" | "eligible" | "path-only" | "draft" | "unavailable";
};

export type AdminPublishedSiteDomainsPage = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  routingEnabled: boolean;
  items: AdminPublishedSiteDomainItem[];
};

export class PublicSiteSubdomainStoreUnavailableError extends Error {
  constructor(message = "DATABASE_URL is not configured for subdomain routing.") {
    super(message);
    this.name = "PublicSiteSubdomainStoreUnavailableError";
  }
}

type PublicSiteSubdomainAccessAdapter = (
  slug: string,
) => Promise<PublicSiteSubdomainAccess>;
type AdminPublishedSiteDomainsAdapter = (
  input: { page: number; pageSize: number },
) => Promise<AdminPublishedSiteDomainsPage>;

let testAccessAdapter: PublicSiteSubdomainAccessAdapter | null = null;
let testAdminListAdapter: AdminPublishedSiteDomainsAdapter | null = null;

export function setPublicSiteSubdomainAccessAdapterForTests(
  adapter: PublicSiteSubdomainAccessAdapter,
): void {
  testAccessAdapter = adapter;
}

export function resetPublicSiteSubdomainAccessAdapterForTests(): void {
  testAccessAdapter = null;
}

export function setAdminPublishedSiteDomainsAdapterForTests(
  adapter: AdminPublishedSiteDomainsAdapter,
): void {
  testAdminListAdapter = adapter;
}

export function resetAdminPublishedSiteDomainsAdapterForTests(): void {
  testAdminListAdapter = null;
}

export function isSubdomainRoutingEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment[SUBDOMAIN_ROUTING_ENABLED_ENV]?.trim().toLowerCase() === "true";
}

function queryFor(deps: PublicSiteSubdomainDeps): PublicSiteSubdomainQuery | null {
  if (deps.query) return deps.query;
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) return null;
  return ((text: string, params?: unknown[]) =>
    getPostgresPool(databaseUrl).query(text, params)) as PublicSiteSubdomainQuery;
}

function accessDeps(
  deps: PublicSiteSubdomainDeps,
  query: PublicSiteSubdomainQuery,
): GetBespokeSiteAccessDeps {
  return {
    databaseUrl: deps.databaseUrl,
    query: query as unknown as BespokeSiteAccessQuery,
    now: deps.now,
  };
}

function pathCanonicalUrls(slug: string): PublicSiteCanonicalUrls {
  const pageUrl = publicSitePathUrl(slug);
  return {
    pageUrl,
    artworkUrl: `${pageUrl}/artwork`,
    subdomainEligible: false,
    subdomainActive: false,
  };
}

/**
 * Server-only source of truth for whether a live published site may use its
 * slug as a subdomain. The browser never supplies or confirms entitlement.
 */
export async function resolvePublishedSiteSubdomainAccess(
  slug: string,
  deps: PublicSiteSubdomainDeps = {},
): Promise<PublicSiteSubdomainAccess> {
  if (!validateSlug(slug).valid) return { status: "not-found", slug };
  if (process.env.NODE_ENV === "test" && testAccessAdapter) {
    return testAccessAdapter(slug);
  }

  const query = queryFor(deps);
  if (!query) {
    return {
      status: "unavailable",
      slug,
      message: "DATABASE_URL is not configured for subdomain routing.",
    };
  }

  try {
    const siteResult = await query<PublishedSiteOwnerRow>(
      `SELECT slug, owner_wallet_address, visibility
         FROM published_sites
        WHERE slug = $1
        LIMIT 1`,
      [slug],
    );
    const site = siteResult.rows[0];
    if (!site || site.slug !== slug || site.visibility !== "live") {
      return { status: "not-found", slug };
    }

    const access = await (deps.accessLookup ?? getBespokeSiteAccess)(
      site.owner_wallet_address,
      accessDeps(deps, query),
    );
    if (access.status === "unavailable") {
      return {
        status: "unavailable",
        slug,
        message: access.message,
      };
    }
    if (!access.allowed || !access.tier) {
      return {
        status: "path-only",
        slug,
        ownerWalletAddress: site.owner_wallet_address,
      };
    }

    return {
      status: "entitled",
      slug,
      ownerWalletAddress: site.owner_wallet_address,
      tier: access.tier,
      permanent: access.permanent,
    };
  } catch {
    return {
      status: "unavailable",
      slug,
      message: "Published-site entitlement data could not be read.",
    };
  }
}

/** Both the path route and its rewritten subdomain emit this same canonical. */
export async function resolvePublicSiteCanonicalUrls(
  slug: string,
  deps: PublicSiteSubdomainDeps = {},
): Promise<PublicSiteCanonicalUrls> {
  const fallback = pathCanonicalUrls(slug);
  const routingEnabled =
    deps.routingEnabled ?? isSubdomainRoutingEnabled();
  if (!routingEnabled) return fallback;

  const access = await resolvePublishedSiteSubdomainAccess(slug, deps);
  if (access.status !== "entitled") return fallback;

  const pageUrl = publicSiteSubdomainUrl(slug);
  return {
    pageUrl,
    artworkUrl: `${pageUrl}/artwork`,
    subdomainEligible: true,
    subdomainActive: true,
  };
}

export async function decideSubdomainRequest(
  input: { host: string | null; pathname: string },
  deps: PublicSiteSubdomainDeps = {},
): Promise<SubdomainRequestDecision> {
  const host = classifySubdomainHost(input.host);
  if (host.kind === "passthrough") return { kind: "next" };
  if (host.kind === "reserved") {
    return { kind: "not-found", reason: "reserved", slug: host.slug };
  }
  if (host.kind === "invalid") {
    return { kind: "not-found", reason: "invalid", slug: host.slug };
  }
  if (isSubdomainPlatformAssetPath(input.pathname)) return { kind: "next" };

  const pathname = subdomainRewritePath(host.slug, input.pathname);
  if (!pathname) {
    return { kind: "not-found", reason: "unsupported", slug: host.slug };
  }

  const routingEnabled =
    deps.routingEnabled ?? isSubdomainRoutingEnabled();
  if (!routingEnabled) {
    return { kind: "not-found", reason: "disabled", slug: host.slug };
  }

  const access = await resolvePublishedSiteSubdomainAccess(host.slug, deps);
  if (access.status === "entitled" || access.status === "not-found") {
    // Unknown slugs deliberately reach /[slug], preserving that route's
    // existing honest 404 instead of creating a second lookup/render path.
    return { kind: "rewrite", slug: host.slug, pathname };
  }
  if (access.status === "path-only") {
    return {
      kind: "upgrade-required",
      slug: host.slug,
      pathUrl: publicSitePathUrl(host.slug),
      message:
        "This published site remains available at hoodlums.dev. A custom Hoodlums subdomain is included with Bond + Pro Site, Pro, or Pro Bundle.",
    };
  }

  return { kind: "unavailable", message: access.message };
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < 1) return fallback;
  return Math.min(Number(value), maximum);
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export async function listAdminPublishedSiteDomains(
  input: { page?: number; pageSize?: number } = {},
  deps: PublicSiteSubdomainDeps = {},
): Promise<AdminPublishedSiteDomainsPage> {
  const page = positiveInteger(input.page, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = positiveInteger(input.pageSize, 20, 50);
  if (process.env.NODE_ENV === "test" && testAdminListAdapter) {
    return testAdminListAdapter({ page, pageSize });
  }

  const query = queryFor(deps);
  if (!query) throw new PublicSiteSubdomainStoreUnavailableError();
  const offset = (page - 1) * pageSize;
  const routingEnabled =
    deps.routingEnabled ?? isSubdomainRoutingEnabled();

  const result = await query<AdminPublishedSiteRow>(
    `SELECT slug, token_name, ticker, visibility, owner_wallet_address,
            created_at, COUNT(*) OVER() AS total_count
       FROM published_sites
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [pageSize, offset],
  );
  const total = Number(result.rows[0]?.total_count ?? 0);
  const accessLookup = deps.accessLookup ?? getBespokeSiteAccess;

  const items = await Promise.all(
    result.rows.map(async (row): Promise<AdminPublishedSiteDomainItem> => {
      const access = await accessLookup(
        row.owner_wallet_address,
        accessDeps(deps, query),
      );
      const pathUrl = publicSitePathUrl(row.slug);
      const allowed = access.status === "ready" && access.allowed && Boolean(access.tier);
      const subdomainUrl = allowed ? publicSiteSubdomainUrl(row.slug) : null;
      const live = row.visibility === "live";
      const canonicalUrl =
        allowed && live && routingEnabled && subdomainUrl
          ? subdomainUrl
          : pathUrl;

      let subdomainStatus: AdminPublishedSiteDomainItem["subdomainStatus"];
      if (access.status === "unavailable") subdomainStatus = "unavailable";
      else if (!allowed) subdomainStatus = "path-only";
      else if (!live) subdomainStatus = "draft";
      else subdomainStatus = routingEnabled ? "active" : "eligible";

      return {
        slug: row.slug,
        name: row.token_name,
        ticker: row.ticker,
        visibility: row.visibility,
        ownerWalletAddress: row.owner_wallet_address,
        createdAt: asIso(row.created_at),
        pathUrl,
        subdomainUrl,
        canonicalUrl,
        entitlementTier: access.status === "ready" ? access.tier : null,
        subdomainStatus,
      };
    }),
  );

  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    routingEnabled,
    items,
  };
}

export type PublicSiteSubdomainProbe = {
  status: "ready" | "unavailable";
  routingEnabled: boolean;
  reservedCount: number;
  knownSlug: string | null;
  accessStatus: PublicSiteSubdomainAccess["status"] | null;
  message: string;
};

export async function probePublicSiteSubdomainRouting(
  deps: PublicSiteSubdomainDeps = {},
): Promise<PublicSiteSubdomainProbe> {
  const routingEnabled =
    deps.routingEnabled ?? isSubdomainRoutingEnabled();
  const parser = classifySubdomainHost("healthcheck.hoodlums.dev");
  if (parser.kind !== "tenant" || parser.slug !== "healthcheck") {
    return {
      status: "unavailable",
      routingEnabled,
      reservedCount: RESERVED_SLUGS.size,
      knownSlug: null,
      accessStatus: null,
      message: "The subdomain host parser did not resolve a valid Hoodlums host.",
    };
  }
  if (!RESERVED_SLUGS.has("api") || !RESERVED_SLUGS.has("admin")) {
    return {
      status: "unavailable",
      routingEnabled,
      reservedCount: RESERVED_SLUGS.size,
      knownSlug: null,
      accessStatus: null,
      message: "The shared reserved slug/subdomain list did not load correctly.",
    };
  }

  const query = queryFor(deps);
  if (!query) {
    return {
      status: "unavailable",
      routingEnabled,
      reservedCount: RESERVED_SLUGS.size,
      knownSlug: null,
      accessStatus: null,
      message: "DATABASE_URL is not configured for the subdomain routing probe.",
    };
  }

  try {
    const latest = await query<{ slug: string }>(
      `SELECT slug
         FROM published_sites
        WHERE visibility = 'live'
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const slug = latest.rows[0]?.slug ?? null;
    if (!slug) {
      return {
        status: "ready",
        routingEnabled,
        reservedCount: RESERVED_SLUGS.size,
        knownSlug: null,
        accessStatus: null,
        message: "Host parsing and the reserved list are ready; there is no live published slug to probe yet.",
      };
    }

    const access = await resolvePublishedSiteSubdomainAccess(slug, {
      ...deps,
      query,
    });
    if (access.status === "unavailable" || access.status === "not-found") {
      return {
        status: "unavailable",
        routingEnabled,
        reservedCount: RESERVED_SLUGS.size,
        knownSlug: slug,
        accessStatus: access.status,
        message: "A known live slug could not complete the server-side subdomain entitlement check.",
      };
    }

    return {
      status: "ready",
      routingEnabled,
      reservedCount: RESERVED_SLUGS.size,
      knownSlug: slug,
      accessStatus: access.status,
      message:
        access.status === "entitled"
          ? `${publicSiteSubdomainUrl(slug)} resolves through the paid entitlement gate.`
          : `/${slug} resolves correctly and its unpaid owner remains path-only.`,
    };
  } catch {
    return {
      status: "unavailable",
      routingEnabled,
      reservedCount: RESERVED_SLUGS.size,
      knownSlug: null,
      accessStatus: null,
      message: "The published-site subdomain probe failed or timed out.",
    };
  }
}

export async function buildSubdomainRoutingHealthStage(
  deps: PublicSiteSubdomainDeps = {},
): Promise<AdminPipelineStage> {
  let probe: PublicSiteSubdomainProbe;
  try {
    probe = await withTimeout(
      probePublicSiteSubdomainRouting(deps),
      HEALTH_CHECK_TIMEOUT_MS,
      "Subdomain routing health probe timed out.",
    );
  } catch {
    return {
      id: "subdomain-routing",
      label: "Paid site subdomain routing",
      status: "red",
      message: "The subdomain routing health probe failed or timed out.",
      observedAt: null,
    };
  }

  if (probe.status === "unavailable") {
    const missingDatabase = probe.message.includes("DATABASE_URL");
    return {
      id: "subdomain-routing",
      label: "Paid site subdomain routing",
      status: missingDatabase ? "amber" : "red",
      message: probe.message,
      observedAt: null,
    };
  }

  if (!probe.routingEnabled) {
    return {
      id: "subdomain-routing",
      label: "Paid site subdomain routing",
      status: "amber",
      message: `${probe.message} ${SUBDOMAIN_ROUTING_ENABLED_ENV} is not true, so wildcard requests remain dormant until DNS is ready.`,
      observedAt: null,
    };
  }

  return {
    id: "subdomain-routing",
    label: "Paid site subdomain routing",
    status: probe.knownSlug ? "green" : "amber",
    message: `${probe.message} ${probe.reservedCount} reserved infrastructure names loaded.`,
    observedAt: null,
  };
}
