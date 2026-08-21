import { timingSafeEqual } from "node:crypto";

export const GENERATE_SITE_STYLE_HEADER = "x-hoodlums-api-key";
export const GENERATE_SITE_STYLE_LIMIT = 10;
export const GENERATE_SITE_STYLE_WINDOW_MS = 60 * 60 * 1000;
export const BESPOKE_SITE_CHALLENGE_LIMIT = 20;
export const BESPOKE_SITE_CHALLENGE_WINDOW_MS = 60 * 60 * 1000;
export const PUBLISH_CHALLENGE_LIMIT = 20;
export const PUBLISH_SITE_LIMIT = 10;
export const PUBLISH_WINDOW_MS = 60 * 60 * 1000;
export const ADMIN_CHALLENGE_LIMIT = 20;
export const ADMIN_CHALLENGE_WINDOW_MS = 60 * 60 * 1000;
export const ADMIN_LOGIN_LIMIT = 5;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Public, unauthenticated database-aware health probe. UptimeRobot's free
// five-minute cadence uses only 12 requests/hour; 120/hour leaves generous
// headroom for a second monitor and manual checks without permitting a DB
// hammer. A 15-second route cache independently collapses repeated queries.
export const PUBLIC_HEALTH_LIMIT = 120;
export const PUBLIC_HEALTH_WINDOW_MS = 60 * 60 * 1000;

// IP-level flood protection for the Hoodchat features (issue #237). This is
// deliberately looser than the per-wallet "5 messages per hour" business
// rule enforced in lib/server/hoodchat-store.ts / token-chat-store.ts — that
// rule is the actual product limit; this just stops one IP from hammering
// the endpoints with many wallets.
export const CHAT_CHALLENGE_LIMIT = 30;
export const CHAT_POST_LIMIT = 30;
export const CHAT_REPORT_LIMIT = 20;
export const CHAT_RATE_WINDOW_MS = 60 * 60 * 1000;

// AI Social Studio (issue #332) — every route spends AI tokens, so each gets
// its own named per-IP limit on top of the shared Pro/Pro Bundle entitlement
// check. Voice profile and mascot DNA are heavier one-off "teach" calls;
// draft and scene-image generation are meant to be used repeatedly.
export const SOCIAL_VOICE_PROFILE_LIMIT = 10;
export const SOCIAL_DRAFT_LIMIT = 30;
export const SOCIAL_MASCOT_DNA_LIMIT = 10;
export const SOCIAL_MASCOT_IMAGE_LIMIT = 20;
export const SOCIAL_STUDIO_WINDOW_MS = 60 * 60 * 1000;

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

/** Generic named-store lookup for route-specific flood limits. */
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

/**
 * Challenge issuance is separate from the expensive 10/hour generation
 * budget, so a successful generation still consumes exactly one generation
 * slot while challenge spam remains independently bounded.
 */
export function consumeBespokeSiteChallengeRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    namedRateStore("bespoke-site-challenge"),
    ip,
    BESPOKE_SITE_CHALLENGE_LIMIT,
    BESPOKE_SITE_CHALLENGE_WINDOW_MS,
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

export function resetBespokeSiteChallengeRateLimitForTests() {
  namedRateStore("bespoke-site-challenge").clear();
}

export function resetPublishRateLimitsForTests() {
  publishChallengeRateStore().clear();
  publishSiteRateStore().clear();
}

export function resetAdminRateLimitsForTests() {
  adminChallengeRateStore().clear();
  adminLoginRateStore().clear();
}

export function consumePublicHealthRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    namedRateStore("public-health"),
    ip,
    PUBLIC_HEALTH_LIMIT,
    PUBLIC_HEALTH_WINDOW_MS,
    now,
  );
}

export function resetPublicHealthRateLimitForTests() {
  namedRateStore("public-health").clear();
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

export function consumeSocialVoiceProfileRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("social-voice-profile"), ip, SOCIAL_VOICE_PROFILE_LIMIT, SOCIAL_STUDIO_WINDOW_MS, now);
}

export function consumeSocialDraftRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("social-draft"), ip, SOCIAL_DRAFT_LIMIT, SOCIAL_STUDIO_WINDOW_MS, now);
}

export function consumeSocialMascotDnaRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("social-mascot-dna"), ip, SOCIAL_MASCOT_DNA_LIMIT, SOCIAL_STUDIO_WINDOW_MS, now);
}

export function consumeSocialMascotImageRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("social-mascot-image"), ip, SOCIAL_MASCOT_IMAGE_LIMIT, SOCIAL_STUDIO_WINDOW_MS, now);
}

export function resetSocialStudioRateLimitsForTests() {
  ["social-voice-profile", "social-draft", "social-mascot-dna", "social-mascot-image"].forEach((name) =>
    namedRateStore(name).clear(),
  );
}

// Social Studio connections + review-and-release posting (issue #335).
// "Action" covers every wallet-signed state change (challenge issuance,
// X/Telegram connect and disconnect, approving/canceling a scheduled post);
// "read" covers the plain GET listing endpoints the studio polls.
export const SOCIAL_STUDIO_ACTION_LIMIT = 20;
export const SOCIAL_STUDIO_READ_LIMIT = 60;

export function consumeSocialStudioActionRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("social-studio-action"), ip, SOCIAL_STUDIO_ACTION_LIMIT, SOCIAL_STUDIO_WINDOW_MS, now);
}

export function consumeSocialStudioReadRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("social-studio-read"), ip, SOCIAL_STUDIO_READ_LIMIT, SOCIAL_STUDIO_WINDOW_MS, now);
}

export function resetSocialStudioActionRateLimitsForTests() {
  ["social-studio-action", "social-studio-read"].forEach((name) => namedRateStore(name).clear());
}

// Street Team add-on interest capture (issue #343) — a lightweight demand
// signal, not a sensitive write, so it gets a single generous per-IP limit
// rather than separate read/action buckets.
export const STREET_TEAM_INTEREST_LIMIT = 20;
export const STREET_TEAM_INTEREST_WINDOW_MS = 60 * 60 * 1000;

export function consumeStreetTeamInterestRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    namedRateStore("street-team-interest"),
    ip,
    STREET_TEAM_INTEREST_LIMIT,
    STREET_TEAM_INTEREST_WINDOW_MS,
    now,
  );
}

export function resetStreetTeamInterestRateLimitForTests() {
  namedRateStore("street-team-interest").clear();
}

// Client-side crash reporting (issue #353). No wallet auth — errors happen
// to anonymous visitors too — so this is the main abuse control. Deliberately
// tighter than the client's own per-session cap (20) since one IP can front
// many devices/tabs, and a crash loop that clears sessionStorage (e.g. a
// private/incognito reload) must still not flood the store.
export const CLIENT_ERRORS_LIMIT = 40;
export const CLIENT_ERRORS_WINDOW_MS = 60 * 60 * 1000;

export function consumeClientErrorsRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("client-errors"), ip, CLIENT_ERRORS_LIMIT, CLIENT_ERRORS_WINDOW_MS, now);
}

export function resetClientErrorsRateLimitForTests() {
  namedRateStore("client-errors").clear();
}

/**
 * Same-origin check for Social Studio connect/posting endpoints, mirroring
 * isAdminRequestOriginAllowed's fallback chain (falls back to the shared
 * publish/generate-site origin config, then the request's own origin, so a
 * dedicated SOCIAL_STUDIO_ALLOWED_ORIGIN is only needed if those diverge).
 */
export function isSocialStudioRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.SOCIAL_STUDIO_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

// Support tickets, Phase A (issue #393): wallet-signed reporting. "Action"
// covers the challenge issuance, ticket creation and follow-up-reply
// endpoints; "read" covers the plain GET listing the /support page polls —
// same challenge/action/read split as Social Studio.
export const SUPPORT_ACTION_LIMIT = 20;
export const SUPPORT_READ_LIMIT = 60;
export const SUPPORT_WINDOW_MS = 60 * 60 * 1000;

export function consumeSupportActionRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("support-action"), ip, SUPPORT_ACTION_LIMIT, SUPPORT_WINDOW_MS, now);
}

export function consumeSupportReadRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("support-read"), ip, SUPPORT_READ_LIMIT, SUPPORT_WINDOW_MS, now);
}

export function resetSupportRateLimitsForTests() {
  ["support-action", "support-read"].forEach((name) => namedRateStore(name).clear());
}

// AI-suggested fixes on admin support tickets (issue #400). Admin-only and
// on-demand (never automatic, each run costs money), so this gets its own
// tight per-IP limit — deliberately much lower than the wallet-facing
// SUPPORT_ACTION_LIMIT above, since it's a single owner operating from
// /admin, not a public-facing endpoint.
export const ADMIN_SUPPORT_SUGGEST_LIMIT = 20;
export const ADMIN_SUPPORT_SUGGEST_WINDOW_MS = 60 * 60 * 1000;

export function consumeAdminSupportSuggestRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("admin-support-suggest"), ip, ADMIN_SUPPORT_SUGGEST_LIMIT, ADMIN_SUPPORT_SUGGEST_WINDOW_MS, now);
}

export function resetAdminSupportSuggestRateLimitForTests() {
  namedRateStore("admin-support-suggest").clear();
}

/**
 * Same-origin check for support-ticket endpoints, mirroring
 * isSocialStudioRequestOriginAllowed's fallback chain (a dedicated
 * SUPPORT_ALLOWED_ORIGIN is only needed if it diverges from the shared
 * publish/generate-site origin config).
 */
export function isSupportRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.SUPPORT_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}
