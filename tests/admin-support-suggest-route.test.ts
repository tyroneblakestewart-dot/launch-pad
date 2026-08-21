import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postSuggest } from "@/app/api/admin/support/suggest/route";
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
import { ADMIN_SUPPORT_SUGGEST_LIMIT, resetAdminSupportSuggestRateLimitForTests } from "@/lib/server/api-protection";
import {
  getSupportTicketsStore,
  resetSupportTicketsStoreForTests,
  setSupportTicketsStoreForTests,
} from "@/lib/server/support-tickets-store";
import { createMemorySupportTicketsStore } from "./support-tickets-test-helpers";

const ORIGIN = "http://localhost:3000";
const SESSION_TOKEN = "admin-suggest-test-session-token";
const WALLET = "0x1111111111111111111111111111111111111111";
let cookie = "";

function jsonResponse(payload: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(payload), init);
}

function suggestionPayload(overrides: Record<string, unknown> = {}) {
  return {
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              probableCause: "The wallet signed with a different account than the one connected in the app.",
              citedKnowledgeIds: ["error:wallet-authorisation-failed"],
              draftReply: "Please double check your wallet is on the same connected account and try again.",
              needsCodeFix: false,
              confidence: "high",
              ...overrides,
            }),
          },
        ],
      },
    ],
  };
}

function request(body?: unknown, options: { authenticated?: boolean; origin?: string } = {}): Request {
  const { authenticated = true, origin = ORIGIN } = options;
  return new Request(`${ORIGIN}/api/admin/support/suggest`, {
    method: "POST",
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
      Origin: origin,
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
  resetAdminSupportSuggestRateLimitForTests();
  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.AI_GATEWAY_API_KEY;
});

afterEach(() => {
  resetAdminStoresForTests();
  resetAdminOperationsStoreForTests();
  resetSupportTicketsStoreForTests();
  resetAdminSupportSuggestRateLimitForTests();
  delete process.env.OPENAI_API_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/admin/support/suggest", () => {
  it("rejects a disallowed origin before any AI call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postSuggest(request({ id: "x" }, { origin: "https://evil.example.com" }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postSuggest(request({ id: "x" }, { authenticated: false }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks the request after the per-IP limit is exhausted", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "account", subject: "s", body: "Wallet authorisation failed.", diagnostics: {} });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(suggestionPayload())));

    for (let index = 0; index < ADMIN_SUPPORT_SUGGEST_LIMIT; index += 1) {
      const response = await postSuggest(request({ id: ticket.id }));
      expect(response.status).toBe(200);
    }
    const blocked = await postSuggest(request({ id: ticket.id }));
    expect(blocked.status).toBe(429);
  });

  it("rejects a malformed ticket id with 400", async () => {
    const response = await postSuggest(request({ id: "not-a-uuid" }));
    expect(response.status).toBe(400);
  });

  it("404s for an unknown ticket", async () => {
    const response = await postSuggest(request({ id: "00000000-0000-0000-0000-000000000000" }));
    expect(response.status).toBe(404);
  });

  it("returns 503 when no AI provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "account", subject: "s", body: "b", diagnostics: {} });
    const response = await postSuggest(request({ id: ticket.id }));
    expect(response.status).toBe(503);
  });

  it("returns a suggestion grounded in the matched knowledge entry, and logs admin activity without the suggestion text", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({
      walletAddress: WALLET,
      category: "account",
      subject: "Can't sign in",
      body: "I keep getting Wallet authorisation failed. when I try to reply.",
      diagnostics: {},
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(suggestionPayload())));

    const response = await postSuggest(request({ id: ticket.id }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { suggestion: { citedKnowledgeIds: string[]; draftReply: string } };
    expect(payload.suggestion.citedKnowledgeIds).toContain("error:wallet-authorisation-failed");
    expect(payload.suggestion.draftReply.length).toBeGreaterThan(0);

    const activity = await getAdminOperationsStore().listActivity(10);
    expect(activity[0]).toMatchObject({ kind: "support-suggestion-generated", serviceKey: "support" });
    expect(activity[0].message).not.toContain(payload.suggestion.draftReply);
  });

  it("regenerates exactly once with corrective feedback when the first suggestion cites an unknown id, and returns the corrected suggestion", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "account", subject: "s", body: "b", diagnostics: {} });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(suggestionPayload({ citedKnowledgeIds: ["error:made-up-id"] })))
      .mockResolvedValueOnce(jsonResponse(suggestionPayload({ citedKnowledgeIds: [], needsCodeFix: true })));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postSuggest(request({ id: ticket.id }));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1] as [string, { body?: string }];
    const retryBody = JSON.parse(retryInit.body ?? "{}") as { input?: Array<{ content?: Array<{ text?: string }> }> };
    const retryDeveloperText = retryBody.input?.[0]?.content?.[0]?.text ?? "";
    expect(retryDeveloperText).toContain("IMPORTANT CORRECTION");
    expect(retryDeveloperText).toContain("unknown knowledge id");
  });

  it("returns a safe error rather than an unchecked suggestion when both attempts violate compliance (issue #364 pattern)", async () => {
    const store = getSupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "account", subject: "s", body: "b", diagnostics: {} });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(suggestionPayload({ draftReply: "We will refund you within 24 hours." })))
      .mockResolvedValueOnce(jsonResponse(suggestionPayload({ draftReply: "We guarantee a refund for this." })));
    vi.stubGlobal("fetch", fetchMock);

    const response = await postSuggest(request({ id: ticket.id }));
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
