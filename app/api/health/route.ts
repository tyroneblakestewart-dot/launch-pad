import { NextResponse } from "next/server";
import {
  consumePublicHealthRateLimit,
  getClientIp,
  resetPublicHealthRateLimitForTests,
} from "@/lib/server/api-protection";
import { getPostgresPool } from "@/lib/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PUBLIC_HEALTH_CACHE_MS = 15_000;
export const PUBLIC_HEALTH_QUERY_TIMEOUT_MS = 3_000;

type PublicHealthStatus = "up" | "down";
type PublicHealthPing = () => Promise<unknown>;

type PublicHealthCache = {
  value: PublicHealthStatus | null;
  expiresAt: number;
  pending: Promise<PublicHealthStatus> | null;
};

type GlobalWithPublicHealthCache = typeof globalThis & {
  __hoodlumsPublicHealthCache?: PublicHealthCache;
};

let testPing: PublicHealthPing | null = null;

function healthCache(): PublicHealthCache {
  const globalScope = globalThis as GlobalWithPublicHealthCache;
  if (!globalScope.__hoodlumsPublicHealthCache) {
    globalScope.__hoodlumsPublicHealthCache = {
      value: null,
      expiresAt: 0,
      pending: null,
    };
  }
  return globalScope.__hoodlumsPublicHealthCache;
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeDatabase(): Promise<PublicHealthStatus> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl && !testPing) return "down";

  const ping = testPing ?? (() => getPostgresPool(databaseUrl).query("SELECT 1"));
  try {
    await withDeadline(Promise.resolve().then(ping), PUBLIC_HEALTH_QUERY_TIMEOUT_MS);
    return "up";
  } catch {
    return "down";
  }
}

async function cachedDatabaseStatus(now = Date.now()): Promise<PublicHealthStatus> {
  const cache = healthCache();
  if (cache.value && cache.expiresAt > now) return cache.value;

  if (!cache.pending) {
    cache.pending = probeDatabase().then((value) => {
      cache.value = value;
      cache.expiresAt = Date.now() + PUBLIC_HEALTH_CACHE_MS;
      return value;
    });
  }

  try {
    return await cache.pending;
  } finally {
    cache.pending = null;
  }
}

function response(status: PublicHealthStatus, httpStatus: number, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(retryAfterSeconds);
  return NextResponse.json({ status }, { status: httpStatus, headers });
}

export async function GET(request: Request) {
  const rate = consumePublicHealthRateLimit(getClientIp(request));
  if (!rate.allowed) return response("down", 429, rate.retryAfterSeconds);

  const status = await cachedDatabaseStatus();
  return response(status, status === "up" ? 200 : 503);
}

export function setPublicHealthPingForTests(ping: PublicHealthPing | null): void {
  testPing = ping;
}

export function resetPublicHealthForTests(): void {
  testPing = null;
  const globalScope = globalThis as GlobalWithPublicHealthCache;
  delete globalScope.__hoodlumsPublicHealthCache;
  resetPublicHealthRateLimitForTests();
}
