import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GET,
  PUBLIC_HEALTH_CACHE_MS,
  PUBLIC_HEALTH_QUERY_TIMEOUT_MS,
  resetPublicHealthForTests,
  setPublicHealthPingForTests,
} from "@/app/api/health/route";
import { PUBLIC_HEALTH_LIMIT } from "@/lib/server/api-protection";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function request(ip = "203.0.113.10") {
  return new Request("https://hoodlums.dev/api/health", {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  resetPublicHealthForTests();
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  vi.useRealTimers();
  resetPublicHealthForTests();
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe("GET /api/health", () => {
  it("returns only up with 200 when the app can reach Postgres", async () => {
    setPublicHealthPingForTests(async () => ({ rows: [{ ok: 1 }] }));
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "up" });
  });

  it("returns only down with 503 when DATABASE_URL is absent", async () => {
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "down" });
  });

  it("never leaks a database error, table, variable, count, version, or stack", async () => {
    setPublicHealthPingForTests(async () => {
      throw new Error('password authentication failed for user postgres in table "subscriptions"');
    });
    const response = await GET(request());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "down" });
    expect(body).not.toContain("password");
    expect(body).not.toContain("postgres");
    expect(body).not.toContain("subscriptions");
    expect(body).not.toContain("DATABASE_URL");
  });

  it("times out a hung database probe and returns down", async () => {
    vi.useFakeTimers();
    setPublicHealthPingForTests(() => new Promise(() => {}));

    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(PUBLIC_HEALTH_QUERY_TIMEOUT_MS);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "down" });
  });

  it("reuses a warm-instance result for 15 seconds, then probes again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    let calls = 0;
    setPublicHealthPingForTests(async () => {
      calls += 1;
      return { rows: [{ ok: 1 }] };
    });

    expect((await GET(request())).status).toBe(200);
    expect((await GET(request())).status).toBe(200);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(PUBLIC_HEALTH_CACHE_MS + 1);
    expect((await GET(request())).status).toBe(200);
    expect(calls).toBe(2);
  });

  it("rate-limits one IP without claiming the service is down", async () => {
    setPublicHealthPingForTests(async () => ({ rows: [{ ok: 1 }] }));
    for (let index = 0; index < PUBLIC_HEALTH_LIMIT; index += 1) {
      expect((await GET(request("198.51.100.44"))).status).toBe(200);
    }

    const response = await GET(request("198.51.100.44"));
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    // A 429 must never assert "down" — that would be a false statement about
    // a healthy service and would page an uptime monitor for a rate limit,
    // not an outage. The 429 status code alone tells the monitor what happened.
    expect(await response.json()).toEqual({});
  });
});
