import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GET as getOperations,
  PATCH as patchOperations,
} from "@/app/api/admin/operations/route";
import type { AdminOperationsSnapshot } from "@/lib/admin-operations";
import {
  ADMIN_SESSION_COOKIE,
  hashAdminSessionToken,
} from "@/lib/server/admin-auth";
import * as adminOperations from "@/lib/server/admin-operations";
import {
  createMemoryAdminOperationsState,
  createMemoryAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  createAdminSession,
  createMemoryAdminSessionState,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import { getServiceIsolationResponse } from "@/lib/server/service-isolation";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-operations-test-session-token";
let cookie = "";

function request(
  method: "GET" | "PATCH",
  body?: unknown,
  authenticated = true,
): Request {
  return new Request(`${ORIGIN}/api/admin/operations`, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const SNAPSHOT: AdminOperationsSnapshot = {
  checkedAt: "2026-08-02T03:00:00.000Z",
  health: [
    {
      id: "database",
      label: "Database",
      status: "green",
      message: "Postgres connection is alive.",
    },
  ],
  services: [],
  activity: [],
  sites: {
    status: "ready",
    total: 3,
    live: 2,
    draft: 1,
    message: "Live counts from Postgres.",
  },
  activeAdminSessions: 1,
  money: {
    status: "ready",
    chainLabel: "Robinhood Chain Testnet",
    launchFee: "0 ETH",
    launchCount: "1",
    feeRecipient: "0x0000000000000000000000000000000000000001",
    feeRecipientBalance: "0 ETH",
    message: "Live factory values.",
  },
  issues: [],
  sectionErrors: [],
};

beforeEach(async () => {
  const sessionState = createMemoryAdminSessionState();
  setAdminSessionStoreForTests(createMemoryAdminSessionStore(sessionState));
  setAdminOperationsStoreForTests(
    createMemoryAdminOperationsStore(createMemoryAdminOperationsState()),
  );
  process.env.PUBLISH_ALLOWED_ORIGIN = ORIGIN;
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  delete process.env.PUBLISH_ALLOWED_ORIGIN;
  resetAdminStoresForTests();
  resetAdminOperationsStoreForTests();
  vi.restoreAllMocks();
});

describe("admin operations API", () => {
  it("rejects unauthenticated reads", async () => {
    const response = await getOperations(request("GET", undefined, false));
    expect(response.status).toBe(401);
  });

  it("returns the complete operations snapshot to an authenticated session", async () => {
    vi.spyOn(adminOperations, "getAdminOperationsSnapshot").mockResolvedValue(
      SNAPSHOT,
    );
    const response = await getOperations(request("GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SNAPSHOT);
  });

  it("requires authentication and an allowed origin for isolation changes", async () => {
    const unauthenticated = await patchOperations(
      request(
        "PATCH",
        {
          serviceKey: "market-feed",
          isolated: true,
          reason: "Provider is failing repeatedly.",
        },
        false,
      ),
    );
    expect(unauthenticated.status).toBe(401);

    const wrongOrigin = new Request(`${ORIGIN}/api/admin/operations`, {
      method: "PATCH",
      headers: {
        Origin: "https://attacker.example",
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serviceKey: "market-feed",
        isolated: true,
        reason: "Provider is failing repeatedly.",
      }),
    });
    expect((await patchOperations(wrongOrigin)).status).toBe(403);
  });

  it("isolates one service without blocking the others, then restores it", async () => {
    const isolate = await patchOperations(
      request("PATCH", {
        serviceKey: "market-feed",
        isolated: true,
        reason: "Provider is returning malformed data while we investigate.",
      }),
    );
    expect(isolate.status).toBe(200);
    await expect(isolate.json()).resolves.toMatchObject({
      control: { key: "market-feed", isolated: true },
    });

    expect((await getServiceIsolationResponse("market-feed"))?.status).toBe(503);
    expect(await getServiceIsolationResponse("website-generation")).toBeNull();
    expect(await getServiceIsolationResponse("public-publishing")).toBeNull();
    expect(await getServiceIsolationResponse("telegram-publishing")).toBeNull();

    const restore = await patchOperations(
      request("PATCH", {
        serviceKey: "market-feed",
        isolated: false,
        reason: "Feed output verified after the provider recovered.",
      }),
    );
    expect(restore.status).toBe(200);
    expect(await getServiceIsolationResponse("market-feed")).toBeNull();
  });

  it("requires a useful reason before isolating a service", async () => {
    const response = await patchOperations(
      request("PATCH", {
        serviceKey: "website-generation",
        isolated: true,
        reason: "bad",
      }),
    );
    expect(response.status).toBe(400);
  });
});
