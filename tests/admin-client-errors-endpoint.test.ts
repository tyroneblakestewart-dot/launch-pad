import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getClientErrors } from "@/app/api/admin/client-errors/route";
import { POST as postClientErrorAction } from "@/app/api/admin/client-errors/actions/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import { resetClientErrorStoreForTests, setClientErrorStoreForTests } from "@/lib/server/client-errors-store";
import { MemoryClientErrorStore } from "./client-errors-test-helpers";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-client-errors-test-session-token";
let cookie = "";

function request(method: string, path: string, body?: unknown, options: { authenticated?: boolean; origin?: string } = {}): Request {
  const { authenticated = true, origin = ORIGIN } = options;
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { Origin: origin } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(async () => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetClientErrorStoreForTests();
});

describe("GET /api/admin/client-errors", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getClientErrors(request("GET", "/api/admin/client-errors", undefined, { authenticated: false }));
    expect(response.status).toBe(401);
  });

  it("returns an unavailable snapshot with no DATABASE_URL configured in this test run, rather than a 500", async () => {
    const response = await getClientErrors(request("GET", "/api/admin/client-errors"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string; groups: unknown[] };
    expect(payload.status).toBe("unavailable");
    expect(payload.groups).toEqual([]);
  });

  it("returns unresolved groups, most frequent first", async () => {
    const store = new MemoryClientErrorStore();
    await store.recordError({
      message: "Frequent error",
      stack: "TypeError: ...",
      routePath: "/social",
      walletAddress: null,
      userAgent: null,
      viewportWidth: null,
      buildId: "abc1234",
    });
    await store.recordError({
      message: "Frequent error",
      stack: "TypeError: ...",
      routePath: "/social",
      walletAddress: "0x1111111111111111111111111111111111111111",
      userAgent: null,
      viewportWidth: null,
      buildId: "abc1234",
    });
    setClientErrorStoreForTests(store);

    const response = await getClientErrors(request("GET", "/api/admin/client-errors"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string; groups: Array<{ occurrenceCount: number }> };
    expect(payload.status).toBe("ready");
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0].occurrenceCount).toBe(2);
  });
});

describe("POST /api/admin/client-errors/actions", () => {
  it("rejects a request from an unauthorised origin", async () => {
    setClientErrorStoreForTests(new MemoryClientErrorStore());
    const response = await postClientErrorAction(
      request("POST", "/api/admin/client-errors/actions", { message: "boom", routePath: "/social" }, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    setClientErrorStoreForTests(new MemoryClientErrorStore());
    const response = await postClientErrorAction(
      request("POST", "/api/admin/client-errors/actions", { message: "boom", routePath: "/social" }, { authenticated: false }),
    );
    expect(response.status).toBe(401);
  });

  it("resolves a group so it drops out of the default listing", async () => {
    const store = new MemoryClientErrorStore();
    await store.recordError({
      message: "boom",
      stack: null,
      routePath: "/social",
      walletAddress: null,
      userAgent: null,
      viewportWidth: null,
      buildId: null,
    });
    setClientErrorStoreForTests(store);

    const response = await postClientErrorAction(
      request("POST", "/api/admin/client-errors/actions", { message: "boom", routePath: "/social" }),
    );
    expect(response.status).toBe(200);

    const listResponse = await getClientErrors(request("GET", "/api/admin/client-errors"));
    const payload = (await listResponse.json()) as { groups: unknown[] };
    expect(payload.groups).toHaveLength(0);
  });

  it("returns 404 for a group with no matching occurrences", async () => {
    setClientErrorStoreForTests(new MemoryClientErrorStore());
    const response = await postClientErrorAction(
      request("POST", "/api/admin/client-errors/actions", { message: "no such error", routePath: "/nowhere" }),
    );
    expect(response.status).toBe(404);
  });
});
