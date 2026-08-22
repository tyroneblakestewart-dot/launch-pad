import { afterEach, describe, expect, it, vi } from "vitest";

// Exercises createPostgresSupportTicketsStore's real SQL/transaction shape
// against a fake pool/client double, rather than only the in-memory test
// helper (issue #393 review, point 3) — proves the locked read-check-write
// sequence, rollback-on-rejection, and rollback-on-error behaviour that the
// in-memory double can't demonstrate since it has no transaction concept.

vi.mock("@/lib/server/postgres", () => ({
  getPostgresPool: vi.fn(),
}));

import { getPostgresPool } from "@/lib/server/postgres";
import {
  MAX_SUPPORT_TICKET_MESSAGES_PER_TICKET,
  createPostgresSupportTicketsStore,
} from "@/lib/server/support-tickets-store";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";
const TICKET_ID = "11111111-1111-1111-1111-111111111111";

type QueryCall = { text: string; params?: unknown[] };

function ticketRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TICKET_ID,
    wallet_address: WALLET,
    category: "other",
    subject: "s",
    body: "b",
    status: "open",
    diagnostics: {},
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function messageRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    ticket_id: TICKET_ID,
    author: "user",
    body: "hi",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createFakeClient(handler: (text: string, params: unknown[] | undefined, calls: QueryCall[]) => { rows: unknown[] } | undefined) {
  const calls: QueryCall[] = [];
  const releaseSpy = vi.fn();
  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      const result = handler(text, params, calls);
      return result ?? { rows: [] };
    }),
    release: releaseSpy,
  };
  return { client, calls, releaseSpy };
}

function installPool(client: unknown, poolQuery?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) {
  const connect = vi.fn(async () => client);
  const pool = {
    connect,
    query: vi.fn(poolQuery ?? (async () => ({ rows: [] }))),
  };
  vi.mocked(getPostgresPool).mockReturnValue(pool as unknown as ReturnType<typeof getPostgresPool>);
  return pool;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("createPostgresSupportTicketsStore — addUserMessage transaction shape", () => {
  it("BEGINs, locks the ticket row FOR UPDATE, inserts + updates, then COMMITs, releasing the client", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow()] };
      if (text.includes("INSERT INTO support_ticket_messages")) return { rows: [messageRow()] };
      if (text.includes("UPDATE support_tickets")) return { rows: [ticketRow()] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addUserMessage(TICKET_ID, WALLET, "more detail");

    expect(result.status).toBe("ok");
    const texts = calls.map((call) => call.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts.some((text) => text.includes("SELECT") && text.includes("FOR UPDATE"))).toBe(true);
    expect(texts.some((text) => text.includes("INSERT INTO support_ticket_messages"))).toBe(true);
    expect(texts.some((text) => text.includes("UPDATE support_tickets") && text.includes("updated_at = NOW()"))).toBe(true);
    expect(texts[texts.length - 1]).toBe("COMMIT");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("clears a pending needs_user status back to open on a successful user reply", async () => {
    const { client } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow({ status: "needs_user" })] };
      if (text.includes("INSERT INTO support_ticket_messages")) return { rows: [messageRow()] };
      if (text.includes("UPDATE support_tickets")) return { rows: [ticketRow({ status: "open" })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addUserMessage(TICKET_ID, WALLET, "still broken");

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.ticket.status).toBe("open");
  });

  it("rolls back, releases the client, and rethrows when the status/updated_at UPDATE returns no row", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow()] };
      if (text.includes("INSERT INTO support_ticket_messages")) return { rows: [messageRow()] };
      if (text.includes("UPDATE support_tickets")) return { rows: [] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    await expect(store.addUserMessage(TICKET_ID, WALLET, "more detail")).rejects.toThrow(
      "The support ticket could not be updated.",
    );
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("rolls back and never inserts when the ticket does not exist", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addUserMessage(TICKET_ID, WALLET, "more detail");

    expect(result.status).toBe("not_found");
    expect(calls.map((call) => call.text)).toEqual(["BEGIN", expect.stringContaining("FOR UPDATE"), "ROLLBACK"]);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("rolls back and never inserts when the ticket belongs to a different wallet", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow({ wallet_address: OTHER_WALLET })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addUserMessage(TICKET_ID, WALLET, "more detail");

    expect(result.status).toBe("forbidden");
    expect(calls.some((call) => call.text.includes("INSERT"))).toBe(false);
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
  });

  it("rolls back and never inserts a reply on a solved/closed ticket", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow({ status: "closed" })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addUserMessage(TICKET_ID, WALLET, "still broken");

    expect(result.status).toBe("closed");
    expect(calls.some((call) => call.text.includes("INSERT"))).toBe(false);
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
  });

  it("rolls back, releases the client, and rethrows when the insert fails unexpectedly", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow()] };
      if (text.includes("INSERT INTO support_ticket_messages")) throw new Error("connection reset");
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    await expect(store.addUserMessage(TICKET_ID, WALLET, "more detail")).rejects.toThrow("connection reset");
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createPostgresSupportTicketsStore — addOwnerMessage transaction shape", () => {
  it("BEGINs, locks the ticket row, inserts + flips status to needs_user, then COMMITs", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow()] };
      if (text.includes("INSERT INTO support_ticket_messages")) return { rows: [messageRow({ author: "owner" })] };
      if (text.includes("status = 'needs_user'")) return { rows: [ticketRow({ status: "needs_user" })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addOwnerMessage(TICKET_ID, "we're looking into it");

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.ticket.status).toBe("needs_user");
    expect(calls[0].text).toBe("BEGIN");
    expect(calls[calls.length - 1].text).toBe("COMMIT");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects a solved/closed ticket rather than implicitly reopening it (issue #393 review)", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow({ status: "solved" })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addOwnerMessage(TICKET_ID, "reply");

    expect(result.status).toBe("closed");
    expect(calls.some((call) => call.text.includes("INSERT"))).toBe(false);
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
  });

  it("rolls back for an unknown ticket", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addOwnerMessage(TICKET_ID, "reply");

    expect(result.status).toBe("not_found");
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
  });

  it("rejects a reply to an anonymous (wallet-less) ticket rather than writing an unreadable message (issue #405)", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow({ wallet_address: null, reference_code: "ABCD-EFGH23" })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.addOwnerMessage(TICKET_ID, "are you still there?");

    expect(result.status).toBe("anonymous");
    expect(calls.some((call) => call.text.includes("INSERT"))).toBe(false);
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
  });
});

describe("createPostgresSupportTicketsStore — closeTicketByUser transaction shape (issue #401)", () => {
  it("BEGINs, locks the ticket row FOR UPDATE, flips status to closed, then COMMITs, releasing the client", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow()] };
      if (text.includes("UPDATE support_tickets")) return { rows: [ticketRow({ status: "closed" })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.closeTicketByUser(TICKET_ID, WALLET);

    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.ticket.status).toBe("closed");
    const texts = calls.map((call) => call.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts.some((text) => text.includes("SELECT") && text.includes("FOR UPDATE"))).toBe(true);
    expect(texts.some((text) => text.includes("UPDATE support_tickets") && text.includes("status = 'closed'"))).toBe(true);
    expect(texts[texts.length - 1]).toBe("COMMIT");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("rolls back and never updates when the ticket does not exist", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.closeTicketByUser(TICKET_ID, WALLET);

    expect(result.status).toBe("not_found");
    expect(calls.map((call) => call.text)).toEqual(["BEGIN", expect.stringContaining("FOR UPDATE"), "ROLLBACK"]);
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("rolls back and never updates when the ticket belongs to a different wallet", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow({ wallet_address: OTHER_WALLET })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.closeTicketByUser(TICKET_ID, WALLET);

    expect(result.status).toBe("forbidden");
    expect(calls.some((call) => call.text.includes("UPDATE support_tickets"))).toBe(false);
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
  });

  it("rolls back and rejects re-closing an already solved/closed ticket (terminal status)", async () => {
    const { client, calls } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow({ status: "closed" })] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    const result = await store.closeTicketByUser(TICKET_ID, WALLET);

    expect(result.status).toBe("closed");
    expect(calls.some((call) => call.text.includes("UPDATE support_tickets"))).toBe(false);
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
  });

  it("rolls back, releases the client, and rethrows when the UPDATE fails unexpectedly", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow()] };
      if (text.includes("UPDATE support_tickets")) throw new Error("connection reset");
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    await expect(store.closeTicketByUser(TICKET_ID, WALLET)).rejects.toThrow("connection reset");
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it("rolls back, releases the client, and rethrows when the UPDATE returns no row", async () => {
    const { client, calls, releaseSpy } = createFakeClient((text) => {
      if (text === "BEGIN" || text === "COMMIT") return { rows: [] };
      if (text.includes("FOR UPDATE")) return { rows: [ticketRow()] };
      if (text.includes("UPDATE support_tickets")) return { rows: [] };
      return { rows: [] };
    });
    installPool(client);

    const store = createPostgresSupportTicketsStore("postgres://test");
    await expect(store.closeTicketByUser(TICKET_ID, WALLET)).rejects.toThrow(
      "The support ticket could not be closed.",
    );
    expect(calls[calls.length - 1].text).toBe("ROLLBACK");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createPostgresSupportTicketsStore — bounded message reads", () => {
  it("caps messages per ticket via a ROW_NUMBER window function, not an unbounded read", async () => {
    let capturedText = "";
    let capturedParams: unknown[] | undefined;
    installPool(
      { query: vi.fn(), release: vi.fn() },
      async (text: string, params?: unknown[]) => {
        if (text.includes("information_schema")) return { rows: [] };
        if (text.includes("support_ticket_messages")) {
          capturedText = text;
          capturedParams = params;
          return { rows: [] };
        }
        return { rows: [ticketRow()] };
      },
    );

    const store = createPostgresSupportTicketsStore("postgres://test");
    await store.listForWallet(WALLET);

    expect(capturedText).toContain("ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY created_at DESC)");
    expect(capturedText).toContain("rn <=");
    expect(capturedParams?.[1]).toBe(MAX_SUPPORT_TICKET_MESSAGES_PER_TICKET);
  });
});
