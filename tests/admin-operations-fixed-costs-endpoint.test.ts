import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteFixedCost, PATCH as patchFixedCost, POST as postFixedCost } from "@/app/api/admin/operations/fixed-costs/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionState,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import { createMemoryFixedOperatingCostsStore, resetFixedOperatingCostsStoreForTests, setFixedOperatingCostsStoreForTests } from "@/lib/server/fixed-operating-costs-store";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "fixed-costs-test-session-token";
let cookie = "";

function request(method: "POST" | "PATCH" | "DELETE", body?: unknown, options: { authenticated?: boolean; origin?: string } = {}): Request {
  const { authenticated = true, origin = ORIGIN } = options;
  return new Request(`${ORIGIN}/api/admin/operations/fixed-costs`, {
    method,
    headers: {
      Origin: origin,
      ...(authenticated ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(async () => {
  const sessionState = createMemoryAdminSessionState();
  setAdminSessionStoreForTests(createMemoryAdminSessionStore(sessionState));
  setFixedOperatingCostsStoreForTests(createMemoryFixedOperatingCostsStore());
  process.env.PUBLISH_ALLOWED_ORIGIN = ORIGIN;
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  delete process.env.PUBLISH_ALLOWED_ORIGIN;
  resetAdminStoresForTests();
  resetFixedOperatingCostsStoreForTests();
});

describe("POST /api/admin/operations/fixed-costs", () => {
  it("requires authentication", async () => {
    const response = await postFixedCost(request("POST", { name: "Vercel", amountUsd: 20, cadence: "monthly" }, { authenticated: false }));
    expect(response.status).toBe(401);
  });

  it("requires an allowed origin", async () => {
    const response = await postFixedCost(
      request("POST", { name: "Vercel", amountUsd: 20, cadence: "monthly" }, { origin: "https://attacker.example" }),
    );
    expect(response.status).toBe(403);
  });

  it("validates name, amount and cadence", async () => {
    expect((await postFixedCost(request("POST", { name: "", amountUsd: 20, cadence: "monthly" }))).status).toBe(400);
    expect((await postFixedCost(request("POST", { name: "Vercel", amountUsd: -5, cadence: "monthly" }))).status).toBe(400);
    expect((await postFixedCost(request("POST", { name: "Vercel", amountUsd: 20, cadence: "weekly" }))).status).toBe(400);
    expect((await postFixedCost(request("POST", { name: "Vercel", amountUsd: Number.NaN, cadence: "monthly" }))).status).toBe(400);
  });

  it("creates a fixed cost with a trimmed note defaulting to null", async () => {
    const response = await postFixedCost(request("POST", { name: "  Vercel hosting  ", amountUsd: 20, cadence: "monthly", note: "   " }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { fixedCost: { name: string; amountUsd: number; note: string | null; monthlyEquivalentUsd: number } };
    expect(body.fixedCost).toMatchObject({ name: "Vercel hosting", amountUsd: 20, note: null, monthlyEquivalentUsd: 20 });
  });

  it("computes the monthly equivalent for an annual entry", async () => {
    const response = await postFixedCost(request("POST", { name: "Domain", amountUsd: 120, cadence: "annual" }));
    const body = (await response.json()) as { fixedCost: { monthlyEquivalentUsd: number } };
    expect(body.fixedCost.monthlyEquivalentUsd).toBeCloseTo(10, 10);
  });
});

describe("PATCH /api/admin/operations/fixed-costs", () => {
  it("requires authentication and an allowed origin", async () => {
    expect((await patchFixedCost(request("PATCH", { id: "x", name: "a", amountUsd: 1, cadence: "monthly" }, { authenticated: false }))).status).toBe(401);
    expect(
      (await patchFixedCost(request("PATCH", { id: "x", name: "a", amountUsd: 1, cadence: "monthly" }, { origin: "https://attacker.example" }))).status,
    ).toBe(403);
  });

  it("updates an existing fixed cost", async () => {
    const created = await postFixedCost(request("POST", { name: "Vercel", amountUsd: 20, cadence: "monthly" }));
    const { fixedCost } = (await created.json()) as { fixedCost: { id: string } };

    const updated = await patchFixedCost(request("PATCH", { id: fixedCost.id, name: "Vercel Pro", amountUsd: 30, cadence: "monthly", note: "upgraded" }));
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as { fixedCost: { name: string; amountUsd: number; note: string | null } };
    expect(body.fixedCost).toMatchObject({ name: "Vercel Pro", amountUsd: 30, note: "upgraded" });
  });

  it("returns 404 for an unknown id", async () => {
    const response = await patchFixedCost(request("PATCH", { id: "does-not-exist", name: "x", amountUsd: 1, cadence: "monthly" }));
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/admin/operations/fixed-costs", () => {
  it("requires authentication and an allowed origin", async () => {
    expect((await deleteFixedCost(request("DELETE", { id: "x" }, { authenticated: false }))).status).toBe(401);
    expect((await deleteFixedCost(request("DELETE", { id: "x" }, { origin: "https://attacker.example" }))).status).toBe(403);
  });

  it("removes an existing fixed cost", async () => {
    const created = await postFixedCost(request("POST", { name: "Vercel", amountUsd: 20, cadence: "monthly" }));
    const { fixedCost } = (await created.json()) as { fixedCost: { id: string } };

    const removed = await deleteFixedCost(request("DELETE", { id: fixedCost.id }));
    expect(removed.status).toBe(200);
    expect((await removed.json()) as { removed: boolean }).toEqual({ removed: true });
  });

  it("returns 404 for an unknown id", async () => {
    const response = await deleteFixedCost(request("DELETE", { id: "does-not-exist" }));
    expect(response.status).toBe(404);
  });

  it("requires a non-empty id", async () => {
    const response = await deleteFixedCost(request("DELETE", { id: "" }));
    expect(response.status).toBe(400);
  });
});
