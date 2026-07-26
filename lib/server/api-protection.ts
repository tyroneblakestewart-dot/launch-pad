import { timingSafeEqual } from "node:crypto";

export const GENERATE_SITE_STYLE_HEADER = "x-hoodlums-api-key";
export const GENERATE_SITE_STYLE_LIMIT = 10;
export const GENERATE_SITE_STYLE_WINDOW_MS = 60 * 60 * 1000;
export const PUBLISH_CHALLENGE_LIMIT = 20;
export const PUBLISH_SITE_LIMIT = 10;
export const PUBLISH_WINDOW_MS = 60 * 60 * 1000;

type RateRecord = { count: number; resetAt: number };
type RateStore = Map<string, RateRecord>;

type GenerateSiteProtectionEnvironment = {
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  [key: string]: string | undefined;
};

type GlobalWithRateStore = typeof globalThis & {
  __hoodlumsGenerateSiteStyleRateStore?: RateStore;
  __hoodlumsPublishChallengeRateStore?: RateStore;
  __hoodlumsPublishSiteRateStore?: RateStore;
};

function generateRateStore(): RateStore {
  const globalScope = globalThis as GlobalWithRateStore;
  if (!globalScope.__hoodlumsGenerateSiteStyleRateStore) {
    globalScope.__hoodlumsGenerateSiteStyleRateStore = new Map();
  }
  return globalScope.__hoodlumsGenerateSiteStyleRateStore;
}

function publishChallengeRateStore(): RateStore {
  const globalScope = globalThis as GlobalWithRateStore;
  if (!globalScope.__hoodlumsPublishChallengeRateStore) {
    globalScope.__hoodlumsPublishChallengeRateStore = new Map();
  }
  return globalScope.__hoodlumsPublishChallengeRateStore;
}

function publishSiteRateStore(): RateStore {
  const globalScope = globalThis as GlobalWithRateStore;
  if (!globalScope.__hoodlumsPublishSiteRateStore) {
    globalScope.__hoodlumsPublishSiteRateStore = new Map();
  }
  return globalScope.__hoodlumsPublishSiteRateStore;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normaliseAbsoluteOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normaliseVercelSystemOrigin(value: string | undefined): string | null {
  const host = value
    ?.trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!host || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return null;
  return `https://${host.toLowerCase()}`;
}

export function getGenerateSiteAllowedOrigins(
  allowedOrigin: string,
  environment: GenerateSiteProtectionEnvironment = process.env,
): string[] {
  const origins = new Set<string>();
  const configuredOrigin = normaliseAbsoluteOrigin(allowedOrigin);
  if (configuredOrigin) origins.add(configuredOrigin);

  if (environment.VERCEL_ENV === "preview") {
    const deploymentOrigin = normaliseVercelSystemOrigin(environment.VERCEL_URL);
    const branchOrigin = normaliseVercelSystemOrigin(environment.VERCEL_BRANCH_URL);
    if (deploymentOrigin) origins.add(deploymentOrigin);
    if (branchOrigin) origins.add(branchOrigin);
  }

  return [...origins];
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function isGenerateSiteStyleRequestAuthorised(
  request: Request,
  sharedSecret: string,
  allowedOrigin: string,
  environment: GenerateSiteProtectionEnvironment = process.env,
): boolean {
  const suppliedSecret = request.headers.get(GENERATE_SITE_STYLE_HEADER) || "";
  const requestOrigin = normaliseAbsoluteOrigin(request.headers.get("origin") || undefined);
  const allowedOrigins = getGenerateSiteAllowedOrigins(allowedOrigin, environment);
  return Boolean(
    sharedSecret &&
      requestOrigin &&
      safeEqual(suppliedSecret, sharedSecret) &&
      allowedOrigins.includes(requestOrigin),
  );
}

function consumeRateLimit(store: RateStore, ip: string, limit: number, windowMs: number, now: number) {
  const current = store.get(ip);
  const record = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;

  if (record.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: record.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
    };
  }

  record.count += 1;
  store.set(ip, record);
  return {
    allowed: true,
    remaining: limit - record.count,
    resetAt: record.resetAt,
    retryAfterSeconds: 0,
  };
}

export function consumeGenerateSiteStyleRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    generateRateStore(),
    ip,
    GENERATE_SITE_STYLE_LIMIT,
    GENERATE_SITE_STYLE_WINDOW_MS,
    now,
  );
}

export function consumePublishChallengeRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    publishChallengeRateStore(),
    ip,
    PUBLISH_CHALLENGE_LIMIT,
    PUBLISH_WINDOW_MS,
    now,
  );
}

export function consumePublishSiteRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    publishSiteRateStore(),
    ip,
    PUBLISH_SITE_LIMIT,
    PUBLISH_WINDOW_MS,
    now,
  );
}

export function resetGenerateSiteStyleRateLimitForTests() {
  generateRateStore().clear();
}

export function resetPublishRateLimitsForTests() {
  publishChallengeRateStore().clear();
  publishSiteRateStore().clear();
}
