import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getStreetTeamInterest } from "@/app/api/admin/street-team/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  resetStreetTeamInterestStoreForTests,
  setStreetTeamInterestStoreForTests,
  type StreetTeamInterestRecord,
  type StreetTeamInterestSnapshot,
  type StreetTeamInterestStore,
} from "@/lib/server/street-team-interest-store";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-street-team-test-session-token";
let cookie = "";

class MemoryAdminStreetTeamStore implements StreetTeamInterestStore {
  readonly records: StreetTeamInterestRecord[] = [
    {
      id: "row-1",
      walletAddress: "0x1111111111111111111111111111111111111111",
      currentPlan: "pro",
      createdAt: new Date().toISOString(),
    },
    {
      id: "row-2",
      walletAddress: null,
      currentPlan: "free",
      createdAt: new Date().toISOString(),
    },
  ];

  async recordInterest(): Promise<StreetTeamInterestRecord> {
    throw new Error("not used by this test");
  }
  async hasInterest(): Promise<boolean> {
    return false;
  }
  async listRecent(): Promise<StreetTeamInterestSnapshot> {
    return { status: "ready", message: "ok", count: this.records.length, recent: this.records };
  }
}

function request(authenticated = true): Request {
  return new Request(`${ORIGIN}/api/admin/street-team`, {
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
  resetStreetTeamInterestStoreForTests();
});

describe("GET /api/admin/street-team", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getStreetTeamInterest(request(false));
    expect(response.status).toBe(401);
  });

  it("returns an unavailable snapshot with no DATABASE_URL configured in this test run, rather than a 500", async () => {
    const response = await getStreetTeamInterest(request());
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { status: string; recent: unknown[] };
    expect(payload.status).toBe("unavailable");
    expect(payload.recent).toEqual([]);
  });

  it("returns the count plus recent entries with each entry's current plan", async () => {
    setStreetTeamInterestStoreForTests(new MemoryAdminStreetTeamStore());

    const response = await getStreetTeamInterest(request());
    expect(response.status).toBe(200);
    const payload = (await response.json()) as StreetTeamInterestSnapshot;
    expect(payload.count).toBe(2);
    expect(payload.recent).toHaveLength(2);
    expect(payload.recent[0]).toMatchObject({
      walletAddress: "0x1111111111111111111111111111111111111111",
      currentPlan: "pro",
    });
    expect(payload.recent[1]).toMatchObject({ walletAddress: null, currentPlan: "free" });
  });
});
