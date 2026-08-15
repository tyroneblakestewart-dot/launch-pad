import { afterEach, describe, expect, it } from "vitest";
import { GET as getSubscriptionStatus } from "@/app/api/subscriptions/status/route";
import {
  addTestAccessWallet,
  createMemoryTestAccessStore,
  resetTestAccessStoreForTests,
  setTestAccessStoreForTests,
} from "@/lib/server/test-access";

const WALLET = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  delete process.env.DATABASE_URL;
  resetTestAccessStoreForTests();
});

describe("GET /api/subscriptions/status", () => {
  it("returns unavailable rather than an unsubscribed decision when Postgres cannot be checked", async () => {
    delete process.env.DATABASE_URL;
    const response = await getSubscriptionStatus(
      new Request(`http://localhost:3000/api/subscriptions/status?wallet=${WALLET}`),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Subscription status is temporarily unavailable.",
    });
  });

  it("returns explicit TEST access from the server for an active allowlisted wallet", async () => {
    setTestAccessStoreForTests(createMemoryTestAccessStore());
    await addTestAccessWallet({
      walletAddress: WALLET,
      label: "Status endpoint test wallet",
    });
    process.env.DATABASE_URL = "postgres://example";

    const response = await getSubscriptionStatus(
      new Request(`http://localhost:3000/api/subscriptions/status?wallet=${WALLET}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      walletAddress: WALLET,
      plan: null,
      status: "active",
      active: true,
      accessSource: "test-allowlist",
      paidFrom: null,
      paidUntil: null,
    });
  });
});
