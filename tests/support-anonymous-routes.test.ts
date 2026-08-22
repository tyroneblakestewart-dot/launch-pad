import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as lookupReference } from "@/app/api/support/tickets/reference/route";
import { POST as createAnonymousTicket } from "@/app/api/support/tickets/anonymous/route";
import {
  createMemoryAdminOperationsStore,
  getAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  SUPPORT_ANONYMOUS_CREATE_LIMIT,
  SUPPORT_REFERENCE_LOOKUP_LIMIT,
  resetSupportRateLimitsForTests,
} from "@/lib/server/api-protection";
import {
  getSupportTicketsStore,
  resetSupportTicketsStoreForTests,
  setSupportTicketsStoreForTests,
} from "@/lib/server/support-tickets-store";
import { createMemorySupportTicketsStore } from "./support-tickets-test-helpers";

const ORIGIN = "http://localhost:3000";

function postRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`${ORIGIN}${path}`, { method: "GET" });
}

async function createValidAnonymousTicket(overrides: Partial<{ category: string; subject: string; body: string; attachmentDataUrl: string }> = {}) {
  return createAnonymousTicket(
    postRequest("/api/support/tickets/anonymous", {
      category: overrides.category ?? "other",
      subject: overrides.subject ?? "Wallet won't connect",
      body: overrides.body ?? "My wallet extension keeps timing out, so I can't sign in.",
      attachmentDataUrl: overrides.attachmentDataUrl,
    }),
  );
}

beforeEach(() => {
  process.env.SUPPORT_ALLOWED_ORIGIN = ORIGIN;
  resetSupportRateLimitsForTests();
  setSupportTicketsStoreForTests(createMemorySupportTicketsStore());
  setAdminOperationsStoreForTests(createMemoryAdminOperationsStore());
});

afterEach(() => {
  delete process.env.SUPPORT_ALLOWED_ORIGIN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  resetSupportTicketsStoreForTests();
  resetAdminOperationsStoreForTests();
});

describe("POST /api/support/tickets/anonymous (issue #405)", () => {
  it("creates an anonymous ticket with no wallet signature, returning only a reference code", async () => {
    const response = await createValidAnonymousTicket();
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { referenceCode: string };
    expect(payload.referenceCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{6}$/);
  });

  it("returns the minimal { referenceCode } success shape only — never a ticket object, status, diagnostics or a wallet address (issue #405 review)", async () => {
    const response = await createValidAnonymousTicket();
    const raw = await response.text();
    const payload = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["referenceCode"]);
    expect(raw).not.toContain("diagnostics");
    expect(raw).not.toContain("walletAddress");
    expect(raw).not.toContain('"ticket"');
    expect(raw).not.toContain('"status"');
  });

  it("stores minimal diagnostics that never pretend a subscription/social identity exists", async () => {
    const response = await createValidAnonymousTicket();
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { referenceCode: string };
    const store = getSupportTicketsStore();
    const admin = await store.listForAdmin("all");
    const stored = admin.find((t) => t.referenceCode === payload.referenceCode);
    expect(stored?.diagnostics).toEqual({ mode: "anonymous" });
  });

  it("rejects a disallowed origin", async () => {
    const response = await createAnonymousTicket(
      new Request(`${ORIGIN}/api/support/tickets/anonymous`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ category: "other", subject: "s", body: "b" }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects malformed input (invalid category)", async () => {
    const response = await createValidAnonymousTicket({ category: "not-a-category" });
    expect(response.status).toBe(400);
  });

  it("rejects an empty subject", async () => {
    const response = await createValidAnonymousTicket({ subject: "" });
    expect(response.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const response = await createValidAnonymousTicket({ body: "" });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid screenshot attachment the same way the signed route does", async () => {
    const response = await createValidAnonymousTicket({ attachmentDataUrl: "not-a-data-url" });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toMatch(/could not be read/i);
  });

  it("creates a ticket with a valid screenshot attachment", async () => {
    const response = await createValidAnonymousTicket({ attachmentDataUrl: "data:image/png;base64,aGVsbG8gd29ybGQ=" });
    expect(response.status).toBe(201);
  });

  it("returns 429 once the anonymous per-IP create limit is exceeded, and stays a clear fraction of the signed action limit", async () => {
    expect(SUPPORT_ANONYMOUS_CREATE_LIMIT).toBeLessThan(20);
    let lastStatus = 0;
    for (let i = 0; i < SUPPORT_ANONYMOUS_CREATE_LIMIT + 1; i += 1) {
      const response = await createValidAnonymousTicket();
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("returns 503 when the store is unavailable", async () => {
    resetSupportTicketsStoreForTests();
    delete process.env.DATABASE_URL;
    const response = await createValidAnonymousTicket();
    expect(response.status).toBe(503);
  });

  it("logs ticket-created admin activity without leaking body/subject text", async () => {
    const response = await createValidAnonymousTicket({ subject: "a very specific subject" });
    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity[0]).toMatchObject({ kind: "ticket-created", serviceKey: "support" });
    expect(activity[0].message).not.toContain("a very specific subject");
  });
});

describe("GET /api/support/tickets/reference (issue #405 review: status-only)", () => {
  async function createTicketWithCode(): Promise<string> {
    const response = await createValidAnonymousTicket();
    const payload = (await response.json()) as { referenceCode: string };
    return payload.referenceCode;
  }

  it("returns exactly { status } for a valid, known code — no other field", async () => {
    const referenceCode = await createTicketWithCode();
    const response = await lookupReference(getRequest(`/api/support/tickets/reference?code=${encodeURIComponent(referenceCode)}`));
    expect(response.status).toBe(200);
    const raw = await response.text();
    const payload = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["status"]);
    expect(payload.status).toBe("open");
  });

  it("is normalised case-insensitively (lowercase input still matches)", async () => {
    const referenceCode = await createTicketWithCode();
    const response = await lookupReference(getRequest(`/api/support/tickets/reference?code=${encodeURIComponent(referenceCode.toLowerCase())}`));
    expect(response.status).toBe(200);
  });

  it("never returns referenceCode, category, timestamps, body, subject, attachment, diagnostics, messages, wallet or reply text — status only", async () => {
    const response1 = await createValidAnonymousTicket({
      subject: "a very unique subject line",
      body: "a very unique body of text nobody should see",
      attachmentDataUrl: "data:image/png;base64,aGVsbG8gd29ybGQ=",
    });
    const created = (await response1.json()) as { referenceCode: string };

    const response = await lookupReference(
      getRequest(`/api/support/tickets/reference?code=${encodeURIComponent(created.referenceCode)}`),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("a very unique subject line");
    expect(raw).not.toContain("a very unique body of text");
    expect(raw).not.toContain("base64");
    expect(raw).not.toContain("diagnostics");
    expect(raw).not.toContain("messages");
    expect(raw).not.toContain("wallet");
    expect(raw).not.toContain("subject");
    expect(raw).not.toContain("body");
    expect(raw).not.toContain("attachment");
    expect(raw).not.toContain("category");
    expect(raw).not.toContain("createdAt");
    expect(raw).not.toContain("updatedAt");
    expect(raw).not.toContain(created.referenceCode);

    const payload = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["status"]);
  });

  it("returns a generic 404 for a well-formed but unknown code", async () => {
    const response = await lookupReference(getRequest("/api/support/tickets/reference?code=ZZZZ-999999"));
    expect(response.status).toBe(404);
  });

  it("returns the identical generic 404 for a malformed code, not leaking format validity", async () => {
    const unknown = await lookupReference(getRequest("/api/support/tickets/reference?code=ZZZZ-999999"));
    const malformed = await lookupReference(getRequest("/api/support/tickets/reference?code=not-a-code"));
    const missing = await lookupReference(getRequest("/api/support/tickets/reference?code="));
    expect(malformed.status).toBe(404);
    expect(missing.status).toBe(404);
    const unknownPayload = await unknown.json();
    const malformedPayload = await malformed.json();
    const missingPayload = await missing.json();
    expect(malformedPayload).toEqual(unknownPayload);
    expect(missingPayload).toEqual(unknownPayload);
  });

  it("returns 429 once the per-IP lookup limit is exceeded", async () => {
    let lastStatus = 0;
    for (let i = 0; i < SUPPORT_REFERENCE_LOOKUP_LIMIT + 1; i += 1) {
      const response = await lookupReference(getRequest("/api/support/tickets/reference?code=ZZZZ-999999"));
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("returns 503 when the store is unavailable", async () => {
    resetSupportTicketsStoreForTests();
    delete process.env.DATABASE_URL;
    const response = await lookupReference(getRequest("/api/support/tickets/reference?code=ZZZZ-999999"));
    expect(response.status).toBe(503);
  });
});
