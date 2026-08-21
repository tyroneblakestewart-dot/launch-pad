import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { POST as supportChallenge } from "@/app/api/support/challenge/route";
import { POST as replyTicket } from "@/app/api/support/tickets/[id]/reply/route";
import { GET as listTickets, POST as createTicket } from "@/app/api/support/tickets/route";
import {
  createMemoryAdminOperationsStore,
  getAdminOperationsStore,
  resetAdminOperationsStoreForTests,
  setAdminOperationsStoreForTests,
} from "@/lib/server/admin-operations-store";
import {
  SUPPORT_ACTION_LIMIT,
  SUPPORT_READ_LIMIT,
  resetSupportRateLimitsForTests,
} from "@/lib/server/api-protection";
import { resetChatChallengesForTests } from "@/lib/server/chat-auth";
import {
  getSupportTicketsStore,
  resetSupportTicketsStoreForTests,
  setSupportTicketsStoreForTests,
} from "@/lib/server/support-tickets-store";
import { createMemorySupportTicketsStore } from "./support-tickets-test-helpers";

const ORIGIN = "http://localhost:3000";
const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`,
);
const OTHER_ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff81" as `0x${string}`,
);

/** after() falls back to a fire-and-forget task outside a real request scope (see runAfterResponse) — flush it before asserting. */
async function flushBackgroundWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

async function signedAction(
  account: typeof ACCOUNT,
  purpose: "support:ticket-create" | "support:ticket-reply",
  payload: Record<string, string>,
) {
  const challengeResponse = await supportChallenge(
    postRequest("/api/support/challenge", { walletAddress: account.address, walletChainId: 46630, purpose, payload }),
  );
  expect(challengeResponse.status).toBe(201);
  const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  return { challengeId: challenge.challengeId, nonce: challenge.nonce, signature };
}

async function createSignedTicket(account: typeof ACCOUNT, overrides: Partial<{ category: string; subject: string; body: string }> = {}) {
  const category = overrides.category ?? "payments";
  const subject = overrides.subject ?? "Payment stuck";
  const body = overrides.body ?? "My payment has not confirmed in an hour.";
  const auth = await signedAction(account, "support:ticket-create", { category, subject, body });
  return createTicket(postRequest("/api/support/tickets", { category, subject, body, ...auth }));
}

beforeEach(() => {
  process.env.SUPPORT_ALLOWED_ORIGIN = ORIGIN;
  resetSupportRateLimitsForTests();
  resetChatChallengesForTests();
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

describe("POST /api/support/challenge", () => {
  it("rejects a disallowed origin", async () => {
    const response = await supportChallenge(
      new Request(`${ORIGIN}/api/support/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ walletAddress: ACCOUNT.address, walletChainId: 46630, purpose: "support:ticket-create", payload: {} }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unknown purpose", async () => {
    const response = await supportChallenge(
      postRequest("/api/support/challenge", { walletAddress: ACCOUNT.address, walletChainId: 46630, purpose: "social:x-connect", payload: {} }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a missing wallet address", async () => {
    const response = await supportChallenge(
      postRequest("/api/support/challenge", { walletChainId: 46630, purpose: "support:ticket-create", payload: {} }),
    );
    expect(response.status).toBe(400);
  });

  it("issues a signable challenge for a known purpose", async () => {
    const response = await supportChallenge(
      postRequest("/api/support/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        purpose: "support:ticket-create",
        payload: { category: "other", subject: "s", body: "b" },
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("Purpose: support:ticket-create");
  });

  it("returns 429 once the per-IP action limit is exceeded", async () => {
    let lastStatus = 0;
    for (let i = 0; i < SUPPORT_ACTION_LIMIT + 1; i += 1) {
      const response = await supportChallenge(
        postRequest("/api/support/challenge", {
          walletAddress: ACCOUNT.address,
          walletChainId: 46630,
          purpose: "support:ticket-create",
          payload: { category: "other", subject: "s", body: "b" },
        }),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("POST /api/support/tickets (create)", () => {
  it("rejects a disallowed origin", async () => {
    const auth = await signedAction(ACCOUNT, "support:ticket-create", { category: "other", subject: "s", body: "b" });
    const response = await createTicket(
      new Request(`${ORIGIN}/api/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ category: "other", subject: "s", body: "b", ...auth }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns 429 once the per-IP action limit is exceeded", async () => {
    let lastStatus = 0;
    for (let i = 0; i < SUPPORT_ACTION_LIMIT + 1; i += 1) {
      const response = await createTicket(
        postRequest("/api/support/tickets", { category: "other", subject: "s", body: "b" }),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("does not delay the response on the Telegram alert — resolves before a still-pending Telegram fetch settles (issue #393 review)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:test-token-aaaaaaaaaaaaaaaaaaaa";
    process.env.TELEGRAM_ADMIN_CHAT_ID = "-100123";
    let releaseFetch: (() => void) | null = null;
    const pendingFetch = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      await pendingFetch;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    }) as typeof fetch;
    try {
      const response = await createSignedTicket(ACCOUNT);
      // The route already resolved with 201 even though the Telegram fetch
      // it kicked off is still pending — proves Telegram is off the
      // response's critical path, not merely that a thrown/rejected fetch
      // doesn't fail the route (which resolves synchronously and wouldn't
      // catch a route that incorrectly awaited a pending promise).
      expect(response.status).toBe(201);
    } finally {
      releaseFetch?.();
      globalThis.fetch = originalFetch;
      await flushBackgroundWork();
    }
  });

  it("logs ticket-created admin activity as best-effort background work, without blocking the response", async () => {
    const response = await createSignedTicket(ACCOUNT);
    expect(response.status).toBe(201);
    await flushBackgroundWork();
    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity[0]).toMatchObject({ kind: "ticket-created", serviceKey: "support" });
  });

  it("rejects malformed input (invalid category)", async () => {
    const auth = await signedAction(ACCOUNT, "support:ticket-create", { category: "not-a-category", subject: "s", body: "b" });
    const response = await createTicket(
      postRequest("/api/support/tickets", { category: "not-a-category", subject: "s", body: "b", ...auth }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an empty subject", async () => {
    const response = await createTicket(
      postRequest("/api/support/tickets", { category: "other", subject: "", body: "b", challengeId: "x", nonce: "y", signature: "0x00" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unsigned request (missing challenge fields)", async () => {
    const response = await createTicket(
      postRequest("/api/support/tickets", { category: "other", subject: "s", body: "b" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an invalid signature", async () => {
    const challengeResponse = await supportChallenge(
      postRequest("/api/support/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        purpose: "support:ticket-create",
        payload: { category: "other", subject: "s", body: "b" },
      }),
    );
    const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string };
    const response = await createTicket(
      postRequest("/api/support/tickets", {
        category: "other",
        subject: "s",
        body: "b",
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature: "0x" + "00".repeat(65),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a replayed challenge", async () => {
    const auth = await signedAction(ACCOUNT, "support:ticket-create", { category: "other", subject: "s", body: "b" });
    const first = await createTicket(postRequest("/api/support/tickets", { category: "other", subject: "s", body: "b", ...auth }));
    expect(first.status).toBe(201);
    const replay = await createTicket(postRequest("/api/support/tickets", { category: "other", subject: "s", body: "b", ...auth }));
    expect(replay.status).toBe(409);
  });

  it("creates a ticket with server-assembled diagnostics and never fails when Telegram is unconfigured", async () => {
    const response = await createSignedTicket(ACCOUNT);
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { ticket: { id: string; status: string; diagnostics: unknown; walletAddress: string } };
    expect(payload.ticket.status).toBe("open");
    expect(payload.ticket.walletAddress.toLowerCase()).toBe(ACCOUNT.address.toLowerCase());
    expect(payload.ticket.diagnostics).toBeTruthy();
  });

  it("does not fail ticket creation when the Telegram alert call throws (issue #393)", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "12345:test-token-aaaaaaaaaaaaaaaaaaaa";
    process.env.TELEGRAM_ADMIN_CHAT_ID = "-100123";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network exploded");
    }) as typeof fetch;
    try {
      const response = await createSignedTicket(ACCOUNT);
      expect(response.status).toBe(201);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 503 when the store is unavailable", async () => {
    resetSupportTicketsStoreForTests();
    delete process.env.DATABASE_URL;
    const auth = await signedAction(ACCOUNT, "support:ticket-create", { category: "other", subject: "s", body: "b" });
    const response = await createTicket(postRequest("/api/support/tickets", { category: "other", subject: "s", body: "b", ...auth }));
    expect(response.status).toBe(503);
  });
});

describe("GET /api/support/tickets (list)", () => {
  it("rejects a missing/invalid wallet address", async () => {
    const response = await listTickets(getRequest("/api/support/tickets?walletAddress=not-an-address"));
    expect(response.status).toBe(400);
  });

  it("returns 429 once the per-IP read limit is exceeded", async () => {
    let lastStatus = 0;
    for (let i = 0; i < SUPPORT_READ_LIMIT + 1; i += 1) {
      const response = await listTickets(getRequest(`/api/support/tickets?walletAddress=${ACCOUNT.address}`));
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("returns only the requesting wallet's tickets", async () => {
    await createSignedTicket(ACCOUNT, { subject: "mine" });
    await createSignedTicket(OTHER_ACCOUNT, { subject: "not mine" });

    const response = await listTickets(getRequest(`/api/support/tickets?walletAddress=${ACCOUNT.address}`));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { tickets: Array<{ subject: string }> };
    expect(payload.tickets).toHaveLength(1);
    expect(payload.tickets[0].subject).toBe("mine");
  });
});

describe("POST /api/support/tickets/[id]/reply", () => {
  async function createOpenTicket() {
    const response = await createSignedTicket(ACCOUNT);
    const payload = (await response.json()) as { ticket: { id: string } };
    return payload.ticket.id;
  }

  it("rejects malformed input (empty body)", async () => {
    const ticketId = await createOpenTicket();
    const response = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "", challengeId: "x", nonce: "y", signature: "0x00" }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(response.status).toBe(400);
  });

  it("lets the owning wallet reply", async () => {
    const ticketId = await createOpenTicket();
    const auth = await signedAction(ACCOUNT, "support:ticket-reply", { ticketId, body: "more detail" });
    const response = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "more detail", ...auth }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(response.status).toBe(201);
  });

  it("logs ticket-replied admin activity for a user's own reply, without the reply text (issue #393 review)", async () => {
    const ticketId = await createOpenTicket();
    const auth = await signedAction(ACCOUNT, "support:ticket-reply", { ticketId, body: "a very specific detail" });
    const response = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "a very specific detail", ...auth }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(response.status).toBe(201);
    await flushBackgroundWork();
    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity[0]).toMatchObject({ kind: "ticket-replied", serviceKey: "support" });
    expect(activity[0].message).not.toContain("a very specific detail");
  });

  it("rejects a malformed (non-UUID) ticket id with 400, not a 500 from a raw Postgres uuid comparison (issue #393 review)", async () => {
    const response = await replyTicket(
      postRequest("/api/support/tickets/not-a-uuid/reply", { body: "hi", challengeId: "x", nonce: "y", signature: "0x00" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
  });

  it("rejects an invalid signature", async () => {
    const ticketId = await createOpenTicket();
    const challengeResponse = await supportChallenge(
      postRequest("/api/support/challenge", {
        walletAddress: ACCOUNT.address,
        walletChainId: 46630,
        purpose: "support:ticket-reply",
        payload: { ticketId, body: "more detail" },
      }),
    );
    const challenge = (await challengeResponse.json()) as { challengeId: string; nonce: string };
    const response = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, {
        body: "more detail",
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature: "0x" + "00".repeat(65),
      }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(response.status).toBe(401);
  });

  it("rejects a replayed challenge", async () => {
    const ticketId = await createOpenTicket();
    const auth = await signedAction(ACCOUNT, "support:ticket-reply", { ticketId, body: "more detail" });
    const first = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "more detail", ...auth }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(first.status).toBe(201);
    const replay = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "more detail", ...auth }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(replay.status).toBe(409);
  });

  it("returns 429 once the per-IP action limit is exceeded", async () => {
    const ticketId = await createOpenTicket();
    let lastStatus = 0;
    for (let i = 0; i < SUPPORT_ACTION_LIMIT + 1; i += 1) {
      const response = await replyTicket(
        postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "hi", challengeId: "x", nonce: "y", signature: "0x00" }),
        { params: Promise.resolve({ id: ticketId }) },
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("rejects an attempt against another wallet's ticket", async () => {
    const ticketId = await createOpenTicket();
    const auth = await signedAction(OTHER_ACCOUNT, "support:ticket-reply", { ticketId, body: "not my ticket" });
    const response = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "not my ticket", ...auth }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(response.status).toBe(403);
  });

  it("rejects a reply on a closed ticket", async () => {
    const ticketId = await createOpenTicket();
    await getSupportTicketsStore().setStatus(ticketId, "closed");
    const auth = await signedAction(ACCOUNT, "support:ticket-reply", { ticketId, body: "still broken" });
    const response = await replyTicket(
      postRequest(`/api/support/tickets/${ticketId}/reply`, { body: "still broken", ...auth }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(response.status).toBe(409);
  });

  it("404s for an unknown ticket id", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    const auth = await signedAction(ACCOUNT, "support:ticket-reply", { ticketId: unknownId, body: "hi" });
    const response = await replyTicket(
      postRequest(`/api/support/tickets/${unknownId}/reply`, { body: "hi", ...auth }),
      { params: Promise.resolve({ id: unknownId }) },
    );
    expect(response.status).toBe(404);
  });

  it("rejects a disallowed origin", async () => {
    const ticketId = await createOpenTicket();
    const response = await replyTicket(
      new Request(`${ORIGIN}/api/support/tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ body: "hi", challengeId: "x", nonce: "y", signature: "0x00" }),
      }),
      { params: Promise.resolve({ id: ticketId }) },
    );
    expect(response.status).toBe(403);
  });
});
