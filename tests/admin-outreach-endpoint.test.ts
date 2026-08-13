import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getOutreach } from "@/app/api/admin/outreach/route";
import { POST as postOutreachAction } from "@/app/api/admin/outreach/actions/route";
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
  getOutreachStore,
  resetOutreachStoreForTests,
  setOutreachStoreForTests,
  type InsertOutreachDraftInput,
} from "@/lib/server/outreach-store";
import { createMemoryOutreachStore } from "./outreach-test-helpers";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-outreach-test-session-token";
let cookie = "";

const X_OUTREACH_ENV_KEYS = ["X_OUTREACH_API_KEY", "X_OUTREACH_API_SECRET", "X_OUTREACH_ACCESS_TOKEN", "X_OUTREACH_ACCESS_SECRET"];
const ORIGINAL_ENV: Record<string, string | undefined> = {};

function setFullXOutreachCreds(): void {
  for (const key of X_OUTREACH_ENV_KEYS) process.env[key] = "test-value";
}

function clearXOutreachCreds(): void {
  for (const key of X_OUTREACH_ENV_KEYS) delete process.env[key];
}

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

function draft(overrides: Partial<InsertOutreachDraftInput> = {}): InsertOutreachDraftInput {
  return {
    touch: "first",
    tokenMint: "Mint1",
    tokenName: "Doggo",
    tokenTicker: "DOGGO",
    tokenArtworkUrl: "",
    tokenUrl: "https://pump.fun/coin/Mint1",
    progressPercent: 91,
    creatorXHandle: null,
    templateKey: "first-board-doesnt-lie",
    body: "congrats @hoodlumsdev $DOGGO",
    ...overrides,
  };
}

beforeEach(async () => {
  for (const key of X_OUTREACH_ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
  clearXOutreachCreds();
  setAdminSessionStoreForTests(createMemoryAdminSessionStore());
  setOutreachStoreForTests(createMemoryOutreachStore());
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
  await createAdminSession(hashAdminSessionToken(SESSION_TOKEN));
  cookie = `${ADMIN_SESSION_COOKIE}=${SESSION_TOKEN}`;
});

afterEach(() => {
  for (const key of X_OUTREACH_ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
  resetAdminStoresForTests();
  resetOutreachStoreForTests();
  resetAdminOperationsStoreForTests();
});

describe("GET /api/admin/outreach", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await getOutreach(request("GET", "/api/admin/outreach", undefined, { authenticated: false }));
    expect(response.status).toBe(401);
  });

  it("lists items filtered by status and reports postingConfigured", async () => {
    const store = getOutreachStore();
    await store.insertDraftIfEligible(draft({ tokenMint: "Mint1" }), 10);
    const secondInsert = await store.insertDraftIfEligible(draft({ tokenMint: "Mint2", creatorXHandle: "creatorB" }), 10);
    if (secondInsert.status === "inserted") await store.dismissDraft(secondInsert.item.id);

    const pendingResponse = await getOutreach(request("GET", "/api/admin/outreach?status=pending"));
    expect(pendingResponse.status).toBe(200);
    const pendingPayload = (await pendingResponse.json()) as { items: Array<{ status: string }>; postingConfigured: boolean };
    expect(pendingPayload.items).toHaveLength(1);
    expect(pendingPayload.items[0].status).toBe("pending");
    expect(pendingPayload.postingConfigured).toBe(false);

    const allResponse = await getOutreach(request("GET", "/api/admin/outreach?status=all"));
    const allPayload = (await allResponse.json()) as { items: unknown[] };
    expect(allPayload.items).toHaveLength(2);
  });

  it("reports postingConfigured true once all four X_OUTREACH_* vars are set", async () => {
    setFullXOutreachCreds();
    const response = await getOutreach(request("GET", "/api/admin/outreach"));
    const payload = (await response.json()) as { postingConfigured: boolean };
    expect(payload.postingConfigured).toBe(true);
  });
});

describe("POST /api/admin/outreach/actions", () => {
  it("rejects a disallowed origin", async () => {
    const response = await postOutreachAction(
      request("POST", "/api/admin/outreach/actions", { id: "x", action: "dismiss" }, { origin: "https://evil.example.com" }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects unauthenticated requests", async () => {
    const response = await postOutreachAction(
      request("POST", "/api/admin/outreach/actions", { id: "x", action: "dismiss" }, { authenticated: false }),
    );
    expect(response.status).toBe(401);
  });

  it("dismisses a pending draft", async () => {
    const store = getOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const response = await postOutreachAction(
      request("POST", "/api/admin/outreach/actions", { id: inserted.item.id, action: "dismiss" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { item: { status: string } };
    expect(payload.item.status).toBe("dismissed");

    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity[0]).toMatchObject({ kind: "outreach-dismissed", serviceKey: "outreach" });
  });

  it("edits a pending draft's body", async () => {
    const store = getOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const response = await postOutreachAction(
      request("POST", "/api/admin/outreach/actions", {
        id: inserted.item.id,
        action: "edit",
        body: "edited draft @hoodlumsdev $DOGGO",
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { item: { body: string } };
    expect(payload.item.body).toBe("edited draft @hoodlumsdev $DOGGO");
  });

  it("rejects an edit with an empty body", async () => {
    const store = getOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");

    const response = await postOutreachAction(
      request("POST", "/api/admin/outreach/actions", { id: inserted.item.id, action: "edit", body: "   " }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown draft id", async () => {
    const response = await postOutreachAction(
      request("POST", "/api/admin/outreach/actions", { id: "nonexistent", action: "dismiss" }),
    );
    expect(response.status).toBe(404);
  });

  it("returns 400 when dismissing an already-terminal draft", async () => {
    const store = getOutreachStore();
    const inserted = await store.insertDraftIfEligible(draft(), 10);
    if (inserted.status !== "inserted") throw new Error("expected inserted");
    await store.dismissDraft(inserted.item.id);

    const response = await postOutreachAction(
      request("POST", "/api/admin/outreach/actions", { id: inserted.item.id, action: "dismiss" }),
    );
    expect(response.status).toBe(400);
  });

  describe("approve — dormant by design", () => {
    it("503s with the exact dormant notice when X_OUTREACH_* credentials are absent, without touching the store item", async () => {
      const store = getOutreachStore();
      const inserted = await store.insertDraftIfEligible(draft(), 10);
      if (inserted.status !== "inserted") throw new Error("expected inserted");

      const response = await postOutreachAction(
        request("POST", "/api/admin/outreach/actions", { id: inserted.item.id, action: "approve" }),
      );
      expect(response.status).toBe(503);
      const payload = (await response.json()) as { error: string };
      expect(payload.error).toBe("posting not configured — outreach is dormant");

      const stillPending = await store.getItem(inserted.item.id);
      expect(stillPending?.status).toBe("pending");
    });

    it("still 503s even if credentials are partially set (three of four)", async () => {
      process.env.X_OUTREACH_API_KEY = "a";
      process.env.X_OUTREACH_API_SECRET = "b";
      process.env.X_OUTREACH_ACCESS_TOKEN = "c";
      // X_OUTREACH_ACCESS_SECRET intentionally left unset.

      const store = getOutreachStore();
      const inserted = await store.insertDraftIfEligible(draft(), 10);
      if (inserted.status !== "inserted") throw new Error("expected inserted");

      const response = await postOutreachAction(
        request("POST", "/api/admin/outreach/actions", { id: inserted.item.id, action: "approve" }),
      );
      expect(response.status).toBe(503);
    });
  });

  describe("approve — fully configured", () => {
    it("posts, marks the item posted, and logs it to the admin activity feed", async () => {
      setFullXOutreachCreds();
      const fetchMock = async () =>
        new Response(JSON.stringify({ data: { id: "x-post-123" } }), { status: 201 });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        const store = getOutreachStore();
        const inserted = await store.insertDraftIfEligible(draft(), 10);
        if (inserted.status !== "inserted") throw new Error("expected inserted");

        const response = await postOutreachAction(
          request("POST", "/api/admin/outreach/actions", { id: inserted.item.id, action: "approve" }),
        );
        expect(response.status).toBe(200);
        const payload = (await response.json()) as { item: { status: string; xPostId: string } };
        expect(payload.item.status).toBe("posted");
        expect(payload.item.xPostId).toBe("x-post-123");

        const activity = await getAdminOperationsStore().listActivity(10);
        expect(activity[0]).toMatchObject({ kind: "outreach-posted", serviceKey: "outreach" });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
