import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getAccounts } from "@/app/api/admin/accounts/route";
import { GET as getAccountDetail } from "@/app/api/admin/accounts/[wallet]/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-accounts-test-session-token";
const WALLET = "0x1111111111111111111111111111111111111111";
let cookie = "";

function request(path: string, authenticated = true): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "GET",
    headers: authenticated ? { Cookie: cookie } : {},
  });
}

beforeEach(async () => {
  delete process.env.DATABASE_URL;
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  resetAdminStoresForTests();
});

describe("Admin Accounts endpoints", () => {
  it("rejects unauthenticated account searches", async () => {
    const response = await getAccounts(request("/api/admin/accounts?q=@crew", false));
    expect(response.status).toBe(401);
  });

  it("keeps the support search unavailable rather than writing fallback records when Postgres is not configured", async () => {
    const response = await getAccounts(request(`/api/admin/accounts?q=${WALLET}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects unsupported detail sections before touching account data", async () => {
    const response = await getAccountDetail(
      request(`/api/admin/accounts/${WALLET}?section=everything`),
      { params: Promise.resolve({ wallet: WALLET }) },
    );
    expect(response.status).toBe(400);
  });

  it("rejects unauthenticated account detail requests", async () => {
    const response = await getAccountDetail(
      request(`/api/admin/accounts/${WALLET}`, false),
      { params: Promise.resolve({ wallet: WALLET }) },
    );
    expect(response.status).toBe(401);
  });
});
