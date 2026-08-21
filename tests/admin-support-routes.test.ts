import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getAdminSupport } from "@/app/api/admin/support/route";
import { POST as postAdminSupportAction } from "@/app/api/admin/support/actions/route";
import { ADMIN_SESSION_COOKIE, hashAdminSessionToken } from "@/lib/server/admin-auth";
import {
  createAdminSession,
  createMemoryAdminSessionStore,
  resetAdminStoresForTests,
  setAdminSessionStoreForTests,
} from "@/lib/server/admin-session-store";
import {
  createMemoryAdminOperationsStore,
  getAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  getSupportTicketsStore,
  resetSupportTicketsStoreForTests,
  setSupportTicketsStoreForTests,
} from "@/lib/server/support-tickets-store";
import { createMemorySupportTicketsStore } from "./support-tickets-test-helpers";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-support-test-session-token";
const WALLET = "0x1111111111111111111111111111111111111111";
let cookie = "";

function request(
  method: string,
  path: string,
  body?: unknown,
  options: { authenticated?: boolean; origin?: string } = {},
): Request {
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
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
  setSupportTicketsStoreForTests(createMemorySupportTicketsStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetAdminOperationsStoreForTests();
  resetSupportTicketsStoreForTests();
});

describe("GET /api/admin/support", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getAdminSupport(request("GET", "/api/admin/support", undefined, { authenticated: false }));
    expect(response.status).toBe(401);
  });

  it("lists tickets filtered by status", async () => {
    const store = getSupportTicketsStore();
    const open = await store.create({ walletAddress: WALLET, category: "other", subject: "open one", body: "b", diagnostics: {} });
    const solved = await store.create({ walletAddress: WALLET, category: "other", subject: "solved one", body: "b", diagnostics: {} });
    await store.setStatus(solved.id, "solved");

    const openResponse = await getAdminSupport(request("GET", "/api/admin/support?status=open"));
    expect(openResponse.status).toBe(200);
    const openPayload = (await openResponse.json()) as { tickets: Array<{ id: string }> };
    expect(openPayload.tickets.map((t) => t.id)).toEqual([open.id]);

    const allResponse = await getAdminSupport(request("GET", "/api/admin/support?status=all"));
    const allPayload = (await allResponse.json()) as { tickets: unknown[] };
    expect(allPayload.tickets).toHaveLength(2);
  });

  it("returns full diagnostics and message history", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({
      walletAddress: WALLET,
      category: "payments",
      subject: "s",
      body: "b",
      diagnostics: { plan: { status: "checked", plan: "pro" } },
    });
    await store.addUserMessage(ticket.id, WALLET, "extra detail");

    const response = await getAdminSupport(request("GET", "/api/admin/support?status=all"));
    const payload = (await response.json()) as { tickets: Array<{ diagnostics: Record<string, unknown>; messages: unknown[] }> };
    expect(payload.tickets[0].diagnostics).toEqual({ plan: { status: "checked", plan: "pro" } });
    expect(payload.tickets[0].messages).toHaveLength(1);
  });

  it("rejects an invalid status filter with 400 rather than silently widening it to 'all' (issue #393 review)", async () => {
    const response = await getAdminSupport(request("GET", "/api/admin/support?status=not-a-status"));
    expect(response.status).toBe(400);
  });

  it("treats a missing status query param as 'all'", async () => {
    const store = getSupportTicketsStore();
    await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    const response = await getAdminSupport(request("GET", "/api/admin/support"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { tickets: unknown[] };
    expect(payload.tickets).toHaveLength(1);
  });

  it("degrades to 200 with an empty list when storage is unavailable, matching the store's read-tolerant unconfigured fallback", async () => {
    resetSupportTicketsStoreForTests();
    delete process.env.DATABASE_URL;
    const response = await getAdminSupport(request("GET", "/api/admin/support?status=all"));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { tickets: unknown[] };
    expect(payload.tickets).toEqual([]);
  });
});

describe("POST /api/admin/support/actions", () => {
  it("rejects a disallowed origin", async () => {
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: "x", action: "status", status: "closed" }, { origin: "https://evil.example.com" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: "x", action: "status", status: "closed" }, { authenticated: false }),
    );
    expect(response.status).toBe(401);
  });

  it("replies to a ticket, flips it to needs_user, and logs admin activity without the body", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });

    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: ticket.id, action: "reply", body: "We are looking into it." }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ticket: { status: string } };
    expect(payload.ticket.status).toBe("needs_user");

    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity[0]).toMatchObject({ kind: "ticket-replied", serviceKey: "support" });
    expect(activity[0].message).not.toContain("We are looking into it.");
  });

  it("rejects a malformed (non-UUID) ticket id on a status action with 400, not a 500 from a raw Postgres uuid comparison (issue #393 review)", async () => {
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: "not-a-uuid", action: "status", status: "closed" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a malformed (non-UUID) ticket id on a reply action with 400 (issue #393 review)", async () => {
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: "not-a-uuid", action: "reply", body: "hi" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects replying to a solved/closed ticket rather than implicitly reopening it (issue #393 review)", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    await store.setStatus(ticket.id, "closed");

    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: ticket.id, action: "reply", body: "still here?" }),
    );
    expect(response.status).toBe(409);
  });

  it("rejects a reply with an empty body", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: ticket.id, action: "reply", body: "   " }),
    );
    expect(response.status).toBe(400);
  });

  it("404s replying to an unknown ticket", async () => {
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: "00000000-0000-0000-0000-000000000000", action: "reply", body: "hi" }),
    );
    expect(response.status).toBe(404);
  });

  it("marks a ticket solved", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: ticket.id, action: "status", status: "solved" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ticket: { status: string } };
    expect(payload.ticket.status).toBe("solved");
  });

  it("marks a ticket closed", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: ticket.id, action: "status", status: "closed" }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects a status value other than solved/closed", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: ticket.id, action: "status", status: "open" }),
    );
    expect(response.status).toBe(400);
  });

  it("404s setting status on an unknown ticket", async () => {
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: "00000000-0000-0000-0000-000000000000", action: "status", status: "closed" }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an unknown action", async () => {
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", { id: "x", action: "delete" }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 503 when storage is unavailable", async () => {
    resetSupportTicketsStoreForTests();
    delete process.env.DATABASE_URL;
    const response = await postAdminSupportAction(
      request("POST", "/api/admin/support/actions", {
        id: "00000000-0000-0000-0000-000000000000",
        action: "status",
        status: "closed",
      }),
    );
    expect(response.status).toBe(503);
  });
});
