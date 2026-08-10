import { afterEach, describe, expect, it } from "vitest";
import { GET as getSubscriptionStatus } from "@/app/api/subscriptions/status/route";

const WALLET = "0x1111111111111111111111111111111111111111";

afterEach(() => {
  delete process.env.DATABASE_URL;
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
});
