import { timingSafeEqual } from "node:crypto";

export const GENERATE_SITE_STYLE_HEADER = "x-hoodlums-api-key";
export const GENERATE_SITE_STYLE_LIMIT = 10;
export const GENERATE_SITE_STYLE_WINDOW_MS = 60 * 60 * 1000;

type RateRecord = { count: number; resetAt: number };
type RateStore = Map<string, RateRecord>;

type GlobalWithRateStore = typeof globalThis & {
  __hoodlumsGenerateSiteStyleRateStore?: RateStore;
};

function rateStore(): RateStore {
  const globalScope = globalThis as GlobalWithRateStore;
  if (!globalScope.__hoodlumsGenerateSiteStyleRateStore) {
    globalScope.__hoodlumsGenerateSiteStyleRateStore = new Map();
  }
  return globalScope.__hoodlumsGenerateSiteStyleRateStore;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function isGenerateSiteStyleRequestAuthorised(
  request: Request,
  sharedSecret: string,
  allowedOrigin: string,
): boolean {
  const suppliedSecret = request.headers.get(GENERATE_SITE_STYLE_HEADER) || "";
  const origin = request.headers.get("origin") || "";
  return Boolean(sharedSecret && allowedOrigin && safeEqual(suppliedSecret, sharedSecret) && origin === allowedOrigin);
}

export function consumeGenerateSiteStyleRateLimit(ip: string, now = Date.now()) {
  const store = rateStore();
  const current = store.get(ip);
  const record = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + GENERATE_SITE_STYLE_WINDOW_MS }
    : current;

  if (record.count >= GENERATE_SITE_STYLE_LIMIT) {
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
    remaining: GENERATE_SITE_STYLE_LIMIT - record.count,
    resetAt: record.resetAt,
    retryAfterSeconds: 0,
  };
}

export function resetGenerateSiteStyleRateLimitForTests() {
  rateStore().clear();
}
