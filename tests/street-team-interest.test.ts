import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getInterest, POST as postInterest } from "@/app/api/street-team/interest/route";
import { resetStreetTeamInterestRateLimitForTests } from "@/lib/server/api-protection";
import {
  StreetTeamInterestStoreUnavailableError,
  resetStreetTeamInterestStoreForTests,
  setStreetTeamInterestStoreForTests,
  type StreetTeamInterestPlan,
  type StreetTeamInterestRecord,
  type StreetTeamInterestSnapshot,
  type StreetTeamInterestStore,
} from "@/lib/server/street-team-interest-store";

const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";

class MemoryStreetTeamInterestStore implements StreetTeamInterestStore {
  readonly records: StreetTeamInterestRecord[] = [];

  async recordInterest(walletAddress: string | null): Promise<StreetTeamInterestRecord> {
    const normalised = walletAddress ? walletAddress.toLowerCase() : null;
    const existing = normalised
      ? this.records.find((record) => record.walletAddress === normalised)
      : undefined;
    if (existing) return existing;

    const record: StreetTeamInterestRecord = {
      id: randomUUID(),
      walletAddress: normalised,
      currentPlan: "free" as StreetTeamInterestPlan,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async hasInterest(walletAddress: string): Promise<boolean> {
    return this.records.some((record) => record.walletAddress === walletAddress.toLowerCase());
  }

  async listRecent(limit = 25): Promise<StreetTeamInterestSnapshot> {
    return {
      status: "ready",
      message: "ok",
      count: this.records.length,
      recent: this.records.slice(0, limit),
    };
  }
}

class UnavailableStreetTeamInterestStore implements StreetTeamInterestStore {
  async recordInterest(): Promise<StreetTeamInterestRecord> {
    throw new StreetTeamInterestStoreUnavailableError();
  }
  async hasInterest(): Promise<boolean> {
    return false;
  }
  async listRecent(): Promise<StreetTeamInterestSnapshot> {
    return { status: "unavailable", message: "unavailable", count: 0, recent: [] };
  }
}

function postRequest(body: unknown, ip = "203.0.113.30", origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/street-team/interest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": ip },
    body: JSON.stringify(body),
  });
}

function getRequest(wallet: string) {
  return new Request(
    `http://localhost:3000/api/street-team/interest?wallet=${encodeURIComponent(wallet)}`,
    { method: "GET" },
  );
}

beforeEach(() => {
  process.env.STREET_TEAM_ALLOWED_ORIGIN = "http://localhost:3000";
  resetStreetTeamInterestRateLimitForTests();
});

afterEach(() => {
  delete process.env.STREET_TEAM_ALLOWED_ORIGIN;
  resetStreetTeamInterestStoreForTests();
});

describe("Street Team interest capture", () => {
  it("records interest for a connected wallet and confirms it on a follow-up GET", async () => {
    const store = new MemoryStreetTeamInterestStore();
    setStreetTeamInterestStoreForTests(store);

    const response = await postInterest(postRequest({ walletAddress: WALLET_A }));
    expect(response.status).toBe(201);
    expect(store.records).toHaveLength(1);
    expect(store.records[0].walletAddress).toBe(WALLET_A.toLowerCase());

    const check = await getInterest(getRequest(WALLET_A));
    expect(check.status).toBe(200);
    await expect(check.json()).resolves.toEqual({ registered: true });
  });

  it("allows anonymous interest with no wallet connected", async () => {
    const store = new MemoryStreetTeamInterestStore();
    setStreetTeamInterestStoreForTests(store);

    const response = await postInterest(postRequest({}));
    expect(response.status).toBe(201);
    expect(store.records).toHaveLength(1);
    expect(store.records[0].walletAddress).toBeNull();
  });

  it("is idempotent: registering the same wallet twice never creates a duplicate row", async () => {
    const store = new MemoryStreetTeamInterestStore();
    setStreetTeamInterestStoreForTests(store);

    await postInterest(postRequest({ walletAddress: WALLET_A }));
    const second = await postInterest(postRequest({ walletAddress: WALLET_A }));

    expect(second.status).toBe(201);
    expect(store.records).toHaveLength(1);
  });

  it("keeps separate wallets as separate rows", async () => {
    const store = new MemoryStreetTeamInterestStore();
    setStreetTeamInterestStoreForTests(store);

    await postInterest(postRequest({ walletAddress: WALLET_A }));
    await postInterest(postRequest({ walletAddress: WALLET_B }));

    expect(store.records).toHaveLength(2);
  });

  it("rejects a request from an unauthorised origin", async () => {
    const store = new MemoryStreetTeamInterestStore();
    setStreetTeamInterestStoreForTests(store);

    const response = await postInterest(postRequest({ walletAddress: WALLET_A }, "203.0.113.30", "https://evil.example"));
    expect(response.status).toBe(403);
    expect(store.records).toHaveLength(0);
  });

  it("rejects a malformed wallet address instead of silently treating it as anonymous", async () => {
    const store = new MemoryStreetTeamInterestStore();
    setStreetTeamInterestStoreForTests(store);

    const response = await postInterest(postRequest({ walletAddress: "not-a-wallet" }));
    expect(response.status).toBe(400);
    expect(store.records).toHaveLength(0);
  });

  it("rate-limits repeated requests from the same IP", async () => {
    const store = new MemoryStreetTeamInterestStore();
    setStreetTeamInterestStoreForTests(store);

    for (let index = 0; index < 20; index += 1) {
      const response = await postInterest(
        postRequest({ walletAddress: `0x${String(index).padStart(40, "0")}` }),
      );
      expect(response.status).toBe(201);
    }

    const overLimit = await postInterest(postRequest({ walletAddress: WALLET_A }));
    expect(overLimit.status).toBe(429);
  });

  it("fails closed with a 503 when no database is configured, taking no money and granting no entitlement", async () => {
    setStreetTeamInterestStoreForTests(new UnavailableStreetTeamInterestStore());

    const response = await postInterest(postRequest({ walletAddress: WALLET_A }));
    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("not configured");
  });
});
