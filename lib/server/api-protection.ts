import { timingSafeEqual } from "node:crypto";

export const GENERATE_SITE_STYLE_HEADER = "x-hoodlums-api-key";
export const GENERATE_SITE_STYLE_LIMIT = 10;
export const GENERATE_SITE_STYLE_WINDOW_MS = 60 * 60 * 1000;
export const PUBLISH_CHALLENGE_LIMIT = 20;
export const PUBLISH_SITE_LIMIT = 10;
export const PUBLISH_WINDOW_MS = 60 * 60 * 1000;
export const ADMIN_CHALLENGE_LIMIT = 20;
export const ADMIN_CHALLENGE_WINDOW_MS = 60 * 60 * 1000;
export const ADMIN_LOGIN_LIMIT = 5;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

// IP-level flood protection for the Hoodchat features (issue #237). This is
// deliberately looser than the per-wallet "5 messages per hour" business
// rule enforced in lib/server/hoodchat-store.ts / token-chat-store.ts — that
// rule is the actual product limit; this just stops one IP from hammering
// the endpoints with many wallets.
export const CHAT_CHALLENGE_LIMIT = 30;
export const CHAT_POST_LIMIT = 30;
export const CHAT_REPORT_LIMIT = 20;
export const CHAT_RATE_WINDOW_MS = 60 * 60 * 1000;

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
  __hoodlumsAdminChallengeRateStore?: RateStore;
  __hoodlumsAdminLoginRateStore?: RateStore;
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

function adminChallengeRateStore(): RateStore {
  const globalScope = globalThis as GlobalWithRateStore;
  if (!globalScope.__hoodlumsAdminChallengeRateStore) {
    globalScope.__hoodlumsAdminChallengeRateStore = new Map();
  }
  return globalScope.__hoodlumsAdminChallengeRateStore;
}

function adminLoginRateStore(): RateStore {
  const globalScope = globalThis as GlobalWithRateStore;
  if (!globalScope.__hoodlumsAdminLoginRateStore) {
    globalScope.__hoodlumsAdminLoginRateStore = new Map();
  }
  return globalScope.__hoodlumsAdminLoginRateStore;
}

type GlobalWithNamedRateStores = typeof globalThis & {
  __hoodlumsNamedRateStores?: Map<string, RateStore>;
};

/** Generic named-store lookup, used for the six chat endpoint limiters below. */
function namedRateStore(name: string): RateStore {
  const globalScope = globalThis as GlobalWithNamedRateStores;
  if (!globalScope.__hoodlumsNamedRateStores) {
    globalScope.__hoodlumsNamedRateStores = new Map();
  }
  const stores = globalScope.__hoodlumsNamedRateStores;
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
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

/**
 * Same-origin check for state-changing admin endpoints (challenge/login/logout).
 * Mirrors the ad-hoc `allowedOrigin` helper duplicated across the publish
 * routes, centralised here since four admin routes share it.
 */
export function isAdminRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.ADMIN_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
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

/** Gates issuing a fresh admin wallet-signature challenge, same shape as publish challenges. */
export function consumeAdminChallengeRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    adminChallengeRateStore(),
    ip,
    ADMIN_CHALLENGE_LIMIT,
    ADMIN_CHALLENGE_WINDOW_MS,
    now,
  );
}

/**
 * Gates admin login attempts (wallet signature or password) per IP. Tighter
 * than the challenge limit since this is the brute-force surface for
 * ADMIN_PASSWORD.
 */
export function consumeAdminLoginRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    adminLoginRateStore(),
    ip,
    ADMIN_LOGIN_LIMIT,
    ADMIN_LOGIN_WINDOW_MS,
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

export function resetAdminRateLimitsForTests() {
  adminChallengeRateStore().clear();
  adminLoginRateStore().clear();
}

export function consumeHoodchatChallengeRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("hoodchat-challenge"), ip, CHAT_CHALLENGE_LIMIT, CHAT_RATE_WINDOW_MS, now);
}

export function consumeHoodchatPostRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("hoodchat-post"), ip, CHAT_POST_LIMIT, CHAT_RATE_WINDOW_MS, now);
}

export function consumeHoodchatReportRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("hoodchat-report"), ip, CHAT_REPORT_LIMIT, CHAT_RATE_WINDOW_MS, now);
}

export function consumeTokenChatChallengeRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("token-chat-challenge"), ip, CHAT_CHALLENGE_LIMIT, CHAT_RATE_WINDOW_MS, now);
}

export function consumeTokenChatPostRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("token-chat-post"), ip, CHAT_POST_LIMIT, CHAT_RATE_WINDOW_MS, now);
}

export function consumeTokenChatReportRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("token-chat-report"), ip, CHAT_REPORT_LIMIT, CHAT_RATE_WINDOW_MS, now);
}

export function resetChatRateLimitsForTests() {
  [
    "hoodchat-challenge",
    "hoodchat-post",
    "hoodchat-report",
    "token-chat-challenge",
    "token-chat-post",
    "token-chat-report",
  ].forEach((name) => namedRateStore(name).clear());
}

// Social account verification for the token studio (issue #246). Both
// providers are stateless per-request flows (no durable table), so a single
// generous per-IP window is enough to blunt abuse without needing the
// dedicated stores above.
export const SOCIAL_OAUTH_WINDOW_MS = 60 * 60 * 1000;
export const TWITTER_OAUTH_LIMIT = 20;
export const TELEGRAM_OAUTH_LIMIT = 30;

export function consumeTwitterOAuthRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("twitter-oauth"), ip, TWITTER_OAUTH_LIMIT, SOCIAL_OAUTH_WINDOW_MS, now);
}

export function consumeTelegramOAuthRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("telegram-oauth"), ip, TELEGRAM_OAUTH_LIMIT, SOCIAL_OAUTH_WINDOW_MS, now);
}

export function resetSocialOAuthRateLimitsForTests() {
  ["twitter-oauth", "telegram-oauth"].forEach((name) => namedRateStore(name).clear());
}
