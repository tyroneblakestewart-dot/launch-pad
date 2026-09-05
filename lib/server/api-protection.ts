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
// Sorting-station samples are one short text call each and arrive one per sort tap.
export const SOCIAL_VOICE_SAMPLE_LIMIT = 120;
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

export function consumeSocialVoiceSampleRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("social-voice-sample"), ip, SOCIAL_VOICE_SAMPLE_LIMIT, SOCIAL_STUDIO_WINDOW_MS, now);
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
  ["social-voice-profile", "social-voice-sample", "social-draft", "social-mascot-dna", "social-mascot-image"].forEach((name) =>
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
// Raised for issue #403's live refresh, which reads this same GET from two
// independent places while /support is open: the page's own 60s
// visible-only timer (worst case exactly 60 reads/hour on its own — that
// alone would exhaust the old 60/hour limit with zero headroom) plus a
// focus/visibilitychange refetch fired by *both* the page and the separate
// nav unread-badge check on every tab refocus. A generous but still bounded
// session — say ~20 refocuses in an hour — adds roughly 20 * 2 = 40 more
// reads, plus a couple of one-off loads (initial page mount, nav mount,
// post submit/reply/close reloads). 60 + 40 + a handful of one-offs is
// comfortably under 150/hour with real headroom to spare; it stays a
// per-IP, per-hour cap, not per-wallet or unbounded.
export const SUPPORT_READ_LIMIT = 150;
export const SUPPORT_WINDOW_MS = 60 * 60 * 1000;

export function consumeSupportActionRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("support-action"), ip, SUPPORT_ACTION_LIMIT, SUPPORT_WINDOW_MS, now);
}

export function consumeSupportReadRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("support-read"), ip, SUPPORT_READ_LIMIT, SUPPORT_WINDOW_MS, now);
}

export function resetSupportRateLimitsForTests() {
  ["support-action", "support-read", "support-anonymous-create", "support-reference-lookup"].forEach((name) =>
    namedRateStore(name).clear(),
  );
}

// Anonymous/no-wallet support reporting (issue #405) — no wallet friction at
// all, so creation gets its own materially tighter per-IP limiter: a clear
// fraction (1/4) of SUPPORT_ACTION_LIMIT's 20/hour. Status lookup is
// read-only but still bounded to blunt reference-code enumeration, even
// though the ~8.2e14-value keyspace (31^10 codes, about 49.5 bits) already
// makes guessing impractical.
export const SUPPORT_ANONYMOUS_CREATE_LIMIT = 5;
export const SUPPORT_REFERENCE_LOOKUP_LIMIT = 20;

export function consumeSupportAnonymousCreateRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("support-anonymous-create"), ip, SUPPORT_ANONYMOUS_CREATE_LIMIT, SUPPORT_WINDOW_MS, now);
}

export function consumeSupportReferenceLookupRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("support-reference-lookup"), ip, SUPPORT_REFERENCE_LOOKUP_LIMIT, SUPPORT_WINDOW_MS, now);
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

// Token launches (Milestone A, issue #409 Part 2): wallet-signed recording
// of an on-chain launch, plus a public read the homepage grid will poll
// (issue #403's live-refresh pattern is the required precedent, even though
// wiring the grid itself is left to a follow-up PR — this endpoint's rate
// limit is already sized for that future 30-60s poll so it doesn't need
// revisiting when the grid lands). "Action" covers the challenge and record
// endpoints; "read" covers the plain GET list.
export const TOKEN_LAUNCH_ACTION_LIMIT = 20;
// Sized for a future 30s visible-tab poll (SUPPORT_READ_LIMIT's own
// precedent, issue #403): a 30s timer alone is up to 3600/30 = 120 reads/hour
// from a single open homepage tab, plus a focus/visibilitychange refetch on
// every refocus (a generous ~20/hour) and a couple of one-off loads (initial
// mount, the "trigger an immediate refetch after my own launch completes"
// case from this same issue). 120 + 20 + a handful of one-offs stays
// comfortably under 300/hour with headroom, matching SUPPORT_READ_LIMIT's
// same "generous but still bounded, per-IP per-hour" shape.
export const TOKEN_LAUNCH_READ_LIMIT = 300;
export const TOKEN_LAUNCH_WINDOW_MS = 60 * 60 * 1000;

export function consumeTokenLaunchActionRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("token-launch-action"), ip, TOKEN_LAUNCH_ACTION_LIMIT, TOKEN_LAUNCH_WINDOW_MS, now);
}

export function consumeTokenLaunchReadRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("token-launch-read"), ip, TOKEN_LAUNCH_READ_LIMIT, TOKEN_LAUNCH_WINDOW_MS, now);
}

export function resetTokenLaunchRateLimitsForTests() {
  ["token-launch-action", "token-launch-read"].forEach((name) => namedRateStore(name).clear());
}

/**
 * Same-origin check for token-launch endpoints, mirroring
 * isSupportRequestOriginAllowed's fallback chain (a dedicated
 * TOKEN_LAUNCH_ALLOWED_ORIGIN is only needed if it diverges from the shared
 * publish/generate-site origin config).
 */
export function isTokenLaunchRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin") || "";
  const configured =
    process.env.TOKEN_LAUNCH_ALLOWED_ORIGIN?.trim() ||
    process.env.PUBLISH_ALLOWED_ORIGIN?.trim() ||
    process.env.GENERATE_SITE_STYLE_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;
  return Boolean(origin && origin === configured);
}

// Token trades (issue #430): a public GET reading a bonding curve's
// buy/sell history, polled by the token page's chart + Recent trades tab
// on a shared visible-tab timer (lib/use-token-trades.ts). Tightened from a
// 12s to a 5s interval (issue #466), so a trade is visible to other viewers
// within roughly one poll tick instead of up to ~20s: 3600/5 = 720
// reads/hour from a single open tab; on top of that add a focus/
// visibilitychange refetch on every refocus and the connected wallet's
// own-trade-confirmed refetch, so the limit is set well above the
// timer-alone floor — matching TOKEN_LAUNCH_READ_LIMIT/SUPPORT_READ_LIMIT's
// same "generous but still bounded, per-IP per-hour" shape.
export const TOKEN_TRADES_READ_LIMIT = 1200;
const TOKEN_TRADES_WINDOW_MS = 60 * 60 * 1000;

export function consumeTokenTradesReadRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("token-trades-read"), ip, TOKEN_TRADES_READ_LIMIT, TOKEN_TRADES_WINDOW_MS, now);
}

// Homepage grid cards (issue #440) read this same GET /api/token-trades
// route through lib/use-grid-token-trades.ts, marked with an additive
// `source=grid` query param (issue #453 area 1) so they're charged against
// this separate per-IP bucket instead of TOKEN_TRADES_READ_LIMIT above — a
// busy homepage session must never be able to exhaust a token-detail page's
// budget. Sized from the real 24-card grid maximum
// (components/hoodlums-token-grid.tsx has no page-size cap beyond that):
// each active/near-viewport card polls at use-grid-token-trades.ts's
// POLL_INTERVAL_MS = 60_000 (60s) = 60 reads/hour/card steady state, so
// 24 cards all active at once is 24 * 60 = 1440/hour baseline. On top of
// that, every focus/visibilitychange event fires one immediate refetch per
// still-active card; a realistic session might refocus the tab ~10 times in
// an hour, adding up to 24 * 10 = 240 more. 1440 + 240 = 1680, rounded up
// to 2000 for headroom without approaching the token-detail bucket's own
// 600/hour ceiling.
export const TOKEN_TRADES_GRID_READ_LIMIT = 2000;

export function consumeTokenTradesGridReadRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(namedRateStore("token-trades-grid-read"), ip, TOKEN_TRADES_GRID_READ_LIMIT, TOKEN_TRADES_WINDOW_MS, now);
}

export function resetTokenTradesRateLimitForTests() {
  namedRateStore("token-trades-read").clear();
  namedRateStore("token-trades-grid-read").clear();
}

// Token holder stats (token page v2 part 3): a public GET computing the
// Stats panel's Top 10 % / Dev % / Snipers % rows, polled by the token page
// on a visible-tab-only 60s timer (lib/use-token-holder-stats.ts) that
// matches the server's own 60s cache: 3600/60 = 60 reads/hour from one open
// tab, plus a focus/visibilitychange refetch on every refocus and the
// connected wallet's own-trade-confirmed refetch — the same "generous but
// still bounded, per-IP per-hour" sizing TOKEN_LAUNCH_READ_LIMIT uses for
// the same cadence.
export const TOKEN_HOLDER_STATS_READ_LIMIT = 300;
const TOKEN_HOLDER_STATS_WINDOW_MS = 60 * 60 * 1000;

export function consumeTokenHolderStatsReadRateLimit(ip: string, now = Date.now()) {
  return consumeRateLimit(
    namedRateStore("token-holder-stats-read"),
    ip,
    TOKEN_HOLDER_STATS_READ_LIMIT,
    TOKEN_HOLDER_STATS_WINDOW_MS,
    now,
  );
}

export function resetTokenHolderStatsRateLimitForTests() {
  namedRateStore("token-holder-stats-read").clear();
}
