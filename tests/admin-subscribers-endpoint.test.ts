import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getSubscribers } from "@/app/api/admin/subscribers/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-subscribers-test-session-token";
let cookie = "";

function request(authenticated = true): Request {
  return new Request(`${ORIGIN}/api/admin/subscribers`, {
    method: "GET",
    headers: authenticated ? { Cookie: cookie } : {},
  });
}

beforeEach(async () => {
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
});

describe("GET /api/admin/subscribers", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getSubscribers(request(false));
    expect(response.status).toBe(401);
  });

  it("returns an unavailable snapshot with no subscribers and no DATABASE_URL configured in this test run, rather than a 500", async () => {
    const response = await getSubscribers(request());
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string; rows: unknown[] };
    expect(payload.status).toBe("unavailable");
    expect(payload.rows).toEqual([]);
  });
});
