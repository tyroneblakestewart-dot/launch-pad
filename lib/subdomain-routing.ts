import { RESERVED_SLUGS, validateSlug } from "@/lib/slug";

export const HOODLUMS_ROOT_DOMAIN = "hoodlums.dev";
export const SUBDOMAIN_REWRITE_HEADER = "x-hoodlums-subdomain-rewrite";

export type SubdomainHostClassification =
  | { kind: "passthrough"; hostname: string | null }
  | { kind: "tenant"; hostname: string; slug: string }
  | { kind: "reserved"; hostname: string; slug: string }
  | { kind: "invalid"; hostname: string; slug: string | null };

/**
 * Host headers may include a port, an IPv6 bracket pair, or a comma-separated
 * forwarded-host chain. Only the first host is relevant to the public request.
 */
export function normaliseRequestHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const first = value.split(",", 1)[0]?.trim();
  if (!first) return null;

  try {
    const url = new URL(first.includes("://") ? first : `http://${first}`);
    if (url.username || url.password) return null;
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function isVercelPreviewHostname(hostname: string): boolean {
  return hostname === "vercel.app" || hostname.endsWith(".vercel.app");
}

/**
 * Only a single label immediately before hoodlums.dev can be a token slug.
 * The apex, www alias, localhost and every Vercel preview host pass through.
 */
export function classifySubdomainHost(value: unknown): SubdomainHostClassification {
  const hostname = normaliseRequestHostname(value);
  if (!hostname) return { kind: "passthrough", hostname: null };

  if (
    hostname === HOODLUMS_ROOT_DOMAIN ||
    hostname === `www.${HOODLUMS_ROOT_DOMAIN}` ||
    isLocalHostname(hostname) ||
    isVercelPreviewHostname(hostname)
  ) {
    return { kind: "passthrough", hostname };
  }

  const suffix = `.${HOODLUMS_ROOT_DOMAIN}`;
  if (!hostname.endsWith(suffix)) {
    return { kind: "passthrough", hostname };
  }

  const slug = hostname.slice(0, -suffix.length);
  if (!slug || slug.includes(".")) {
    return { kind: "invalid", hostname, slug: slug || null };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { kind: "reserved", hostname, slug };
  }
  if (!validateSlug(slug).valid) {
    return { kind: "invalid", hostname, slug };
  }

  return { kind: "tenant", hostname, slug };
}

/** Assets needed by Next/Vercel itself are never interpreted as site paths. */
export function isSubdomainPlatformAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vercel/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/assets/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest"
  );
}

/**
 * A token subdomain has exactly two public resources. Both rewrite into the
 * existing slug route so rendering, platform-fact substitution and artwork
 * validation remain single-source.
 */
export function subdomainRewritePath(slug: string, pathname: string): string | null {
  if (pathname === "/" || pathname === "") return `/${slug}`;
  if (pathname === "/artwork" || pathname === "/artwork/") {
    return `/${slug}/artwork`;
  }
  return null;
}

export function publicSitePathUrl(slug: string): string {
  return `https://${HOODLUMS_ROOT_DOMAIN}/${slug}`;
}

export function publicSiteSubdomainUrl(slug: string): string {
  return `https://${slug}.${HOODLUMS_ROOT_DOMAIN}`;
}
