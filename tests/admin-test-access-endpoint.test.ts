import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const activityRecorder = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/server/admin-operations-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/server/admin-operations-store")
  >();
  return {
    ...actual,
    recordAdminActivityBestEffort: activityRecorder,
  };
});

import {
  GET as getTestAccess,
  PATCH as revokeTestAccess,
  POST as addTestAccess,
} from "@/app/api/admin/test-access/route";
import {
  ADMIN_SESSION_COOKIE,
  hashAdminSessionToken,
} from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  createMemoryTestAccessStore,
  isTestAccessWallet,
  resetTestAccessStoreForTests,
  setTestAccessStoreForTests,
  type TestAccessWallet,
} from "@/lib/server/test-access";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-test-access-session-token";
const WALLET_MIXED_CASE = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD";
const WALLET_LOWER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
let cookie = "";

function request(
  method: "GET" | "POST" | "PATCH",
  body?: unknown,
  options: { authenticated?: boolean; origin?: string } = {},
): Request {
  const { authenticated = true, origin = ORIGIN } = options;
  return new Request(`${ORIGIN}/api/admin/test-access`, {
    method,
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(method === "GET" ? {} : { Origin: origin }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  activityRecorder.mockClear();
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  setTestAccessStoreForTests(createMemoryTestAccessStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetTestAccessStoreForTests();
});

describe("/api/admin/test-access authentication", () => {
  it("rejects unauthenticated reads and mutations", async () => {
    const getResponse = await getTestAccess(
      request("GET", undefined, { authenticated: false }),
    );
    const postResponse = await addTestAccess(
      request(
        "POST",
        { walletAddress: WALLET_LOWER, label: "Unauthorised" },
        { authenticated: false },
      ),
    );
    const patchResponse = await revokeTestAccess(
      request(
        "PATCH",
        { id: "11111111-1111-4111-8111-111111111111" },
        { authenticated: false },
      ),
    );

    expect(getResponse.status).toBe(401);
    expect(postResponse.status).toBe(401);
    expect(patchResponse.status).toBe(401);
    expect(activityRecorder).not.toHaveBeenCalled();
  });

  it("rejects mutation requests from a disallowed origin", async () => {
    const response = await addTestAccess(
      request(
        "POST",
        { walletAddress: WALLET_LOWER, label: "Wrong origin" },
        { origin: "https://evil.example" },
      ),
    );
    expect(response.status).toBe(403);
    expect(activityRecorder).not.toHaveBeenCalled();
  });
});

describe("admin test-access lifecycle", () => {
  it("adds a lowercased TEST wallet, lists it, revokes it, retains the audit row, and records both admin actions", async () => {
    const addedResponse = await addTestAccess(
      request("POST", {
        walletAddress: WALLET_MIXED_CASE,
        label: "  Tyrone   iPhone test wallet  ",
      }),
    );
    expect(addedResponse.status).toBe(201);
    const addedPayload = (await addedResponse.json()) as {
      wallet: TestAccessWallet;
    };
    expect(addedPayload.wallet).toMatchObject({
      walletAddress: WALLET_LOWER,
      label: "Tyrone iPhone test wallet",
      active: true,
      revokedAt: null,
    });
    await expect(isTestAccessWallet(WALLET_MIXED_CASE)).resolves.toBe(true);

    const listBefore = await getTestAccess(request("GET"));
    expect(listBefore.status).toBe(200);
    const beforePayload = (await listBefore.json()) as {
      wallets: TestAccessWallet[];
      activeCount: number;
      revokedCount: number;
    };
    expect(beforePayload).toMatchObject({ activeCount: 1, revokedCount: 0 });
    expect(beforePayload.wallets).toHaveLength(1);

    const revokedResponse = await revokeTestAccess(
      request("PATCH", { id: addedPayload.wallet.id }),
    );
    expect(revokedResponse.status).toBe(200);
    const revokedPayload = (await revokedResponse.json()) as {
      wallet: TestAccessWallet;
    };
    expect(revokedPayload.wallet.active).toBe(false);
    expect(revokedPayload.wallet.revokedAt).not.toBeNull();
    await expect(isTestAccessWallet(WALLET_LOWER)).resolves.toBe(false);

    const listAfter = await getTestAccess(request("GET"));
    const afterPayload = (await listAfter.json()) as {
      wallets: TestAccessWallet[];
      activeCount: number;
      revokedCount: number;
    };
    expect(afterPayload).toMatchObject({ activeCount: 0, revokedCount: 1 });
    expect(afterPayload.wallets[0]).toMatchObject({
      walletAddress: WALLET_LOWER,
      active: false,
    });

    expect(activityRecorder).toHaveBeenCalledTimes(2);
    expect(activityRecorder).toHaveBeenNthCalledWith(1, {
      kind: "test-access-added",
      message: expect.stringContaining(
        `TEST access added for ${WALLET_LOWER}: Tyrone iPhone test wallet`,
      ),
    });
    expect(activityRecorder).toHaveBeenNthCalledWith(2, {
      kind: "test-access-revoked",
      message: expect.stringContaining(
        `TEST access revoked for ${WALLET_LOWER}: Tyrone iPhone test wallet`,
      ),
    });
  });

  it("validates wallet addresses and refuses duplicate or revoked-address replacement", async () => {
    const invalid = await addTestAccess(
      request("POST", { walletAddress: "not-a-wallet", label: "Invalid" }),
    );
    expect(invalid.status).toBe(400);

    const first = await addTestAccess(
      request("POST", { walletAddress: WALLET_LOWER, label: "First" }),
    );
    expect(first.status).toBe(201);
    const firstWallet = ((await first.json()) as { wallet: TestAccessWallet }).wallet;

    const duplicate = await addTestAccess(
      request("POST", { walletAddress: WALLET_MIXED_CASE, label: "Duplicate" }),
    );
    expect(duplicate.status).toBe(409);

    await revokeTestAccess(request("PATCH", { id: firstWallet.id }));
    const afterRevoke = await addTestAccess(
      request("POST", { walletAddress: WALLET_LOWER, label: "Replace audit row" }),
    );
    expect(afterRevoke.status).toBe(409);
    const payload = (await afterRevoke.json()) as { error: string };
    expect(payload.error).toContain("audit trail");
  });
});
