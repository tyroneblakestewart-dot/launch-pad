import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSupportTicketsStore,
  isSupportTicketCategory,
  isSupportTicketStatus,
  isValidSupportTicketId,
  resetSupportTicketsStoreForTests,
  setSupportTicketsStoreForTests,
  SupportTicketsStoreUnavailableError,
} from "@/lib/server/support-tickets-store";
import { createMemorySupportTicketsStore } from "./support-tickets-test-helpers";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER_WALLET = "0x2222222222222222222222222222222222222222";

afterEach(() => {
  resetSupportTicketsStoreForTests();
  vi.useRealTimers();
});

describe("isSupportTicketCategory / isSupportTicketStatus", () => {
  it("accepts only the documented values", () => {
    expect(isSupportTicketCategory("account")).toBe(true);
    expect(isSupportTicketCategory("other")).toBe(true);
    expect(isSupportTicketCategory("not-a-category")).toBe(false);
    expect(isSupportTicketStatus("open")).toBe(true);
    expect(isSupportTicketStatus("needs_user")).toBe(true);
    expect(isSupportTicketStatus("archived")).toBe(false);
  });
});

describe("isValidSupportTicketId", () => {
  it("accepts a well-formed UUID and rejects malformed ids (issue #393 review)", () => {
    expect(isValidSupportTicketId("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isValidSupportTicketId("not-a-uuid")).toBe(false);
    expect(isValidSupportTicketId("11111111-1111-1111-1111-11111111111")).toBe(false);
    expect(isValidSupportTicketId("")).toBe(false);
    expect(isValidSupportTicketId(undefined)).toBe(false);
    expect(isValidSupportTicketId(123)).toBe(false);
  });
});

describe("SupportTicketsStore contract (via in-memory double)", () => {
  it("creates a ticket that starts 'open' and is listable by the owning wallet only", async () => {
    const store = createMemorySupportTicketsStore();
    const ticket = await store.create({
      walletAddress: WALLET,
      category: "payments",
      subject: "Payment stuck",
      body: "My payment has not confirmed in an hour.",
      diagnostics: { plan: { status: "unavailable" } },
    });
    expect(ticket.status).toBe("open");

    const mine = await store.listForWallet(WALLET);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(ticket.id);
    expect(mine[0].messages).toEqual([]);

    expect(await store.listForWallet(OTHER_WALLET)).toHaveLength(0);
    // Case-insensitive wallet matching.
    expect(await store.listForWallet(WALLET.toUpperCase())).toHaveLength(1);
  });

  it("lets the owning wallet reply to an open ticket", async () => {
    const store = createMemorySupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });

    const result = await store.addUserMessage(ticket.id, WALLET, "More detail here.");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.message.author).toBe("user");
      expect(result.ticket.status).toBe("open");
    }

    const withMessages = (await store.listForWallet(WALLET))[0];
    expect(withMessages.messages).toHaveLength(1);
  });

  it("rejects a reply from a different wallet", async () => {
    const store = createMemorySupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });

    const result = await store.addUserMessage(ticket.id, OTHER_WALLET, "not mine");
    expect(result.status).toBe("forbidden");
  });

  it("rejects a reply to an unknown ticket", async () => {
    const store = createMemorySupportTicketsStore();
    const result = await store.addUserMessage("00000000-0000-0000-0000-000000000000", WALLET, "hi");
    expect(result.status).toBe("not_found");
  });

  it("rejects a reply once the ticket is solved or closed", async () => {
    const store = createMemorySupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    await store.setStatus(ticket.id, "solved");
    expect((await store.addUserMessage(ticket.id, WALLET, "still broken")).status).toBe("closed");

    await store.setStatus(ticket.id, "closed");
    expect((await store.addUserMessage(ticket.id, WALLET, "still broken")).status).toBe("closed");
  });

  it("allows a reply while needs_user, and clears the flag back to open (issue #393 review)", async () => {
    const store = createMemorySupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    await store.addOwnerMessage(ticket.id, "Can you share more detail?");
    const afterOwnerReply = (await store.listForWallet(WALLET))[0];
    expect(afterOwnerReply.status).toBe("needs_user");

    const result = await store.addUserMessage(ticket.id, WALLET, "Sure, here it is.");
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.ticket.status).toBe("open");

    const afterUserReply = (await store.listForWallet(WALLET))[0];
    expect(afterUserReply.status).toBe("open");
  });

  it("owner reply creates an owner message and flips status to needs_user", async () => {
    const store = createMemorySupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });

    const result = await store.addOwnerMessage(ticket.id, "We're looking into it.");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.message.author).toBe("owner");
      expect(result.ticket.status).toBe("needs_user");
    }
  });

  it("owner reply 404s for an unknown ticket", async () => {
    const store = createMemorySupportTicketsStore();
    expect((await store.addOwnerMessage("00000000-0000-0000-0000-000000000000", "hi")).status).toBe("not_found");
  });

  it("rejects an owner reply once the ticket is solved or closed, rather than implicitly reopening it (issue #393 review)", async () => {
    const store = createMemorySupportTicketsStore();
    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} });
    await store.setStatus(ticket.id, "solved");
    expect((await store.addOwnerMessage(ticket.id, "still here?")).status).toBe("closed");

    await store.setStatus(ticket.id, "closed");
    expect((await store.addOwnerMessage(ticket.id, "still here?")).status).toBe("closed");
  });

  it("filters the admin listing by status, and 'all' returns everything", async () => {
    const store = createMemorySupportTicketsStore();
    const open = await store.create({ walletAddress: WALLET, category: "other", subject: "open one", body: "b", diagnostics: {} });
    const solved = await store.create({ walletAddress: WALLET, category: "other", subject: "solved one", body: "b", diagnostics: {} });
    await store.setStatus(solved.id, "solved");

    expect((await store.listForAdmin("open")).map((t) => t.id)).toEqual([open.id]);
    expect((await store.listForAdmin("solved")).map((t) => t.id)).toEqual([solved.id]);
    expect((await store.listForAdmin("all")).map((t) => t.id).sort()).toEqual([open.id, solved.id].sort());
  });

  it("setStatus 404s for an unknown ticket", async () => {
    const store = createMemorySupportTicketsStore();
    expect((await store.setStatus("00000000-0000-0000-0000-000000000000", "closed")).status).toBe("not_found");
  });

  it("countOpen counts only open and needs_user tickets", async () => {
    const store = createMemorySupportTicketsStore();
    await store.create({ walletAddress: WALLET, category: "other", subject: "a", body: "b", diagnostics: {} });
    const needsUser = await store.create({ walletAddress: WALLET, category: "other", subject: "b", body: "b", diagnostics: {} });
    await store.addOwnerMessage(needsUser.id, "reply");
    const closed = await store.create({ walletAddress: WALLET, category: "other", subject: "c", body: "b", diagnostics: {} });
    await store.setStatus(closed.id, "closed");

    expect(await store.countOpen()).toBe(2);
  });

  it("reports the age of the oldest open ticket, and null when there are none", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = createMemorySupportTicketsStore();
    expect(await store.oldestOpenTicketAgeSeconds(new Date("2026-01-01T00:00:00.000Z"))).toBeNull();

    const ticket = await store.create({ walletAddress: WALLET, category: "other", subject: "a", body: "b", diagnostics: {} });
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    const laterTicket = await store.create({ walletAddress: WALLET, category: "other", subject: "b", body: "b", diagnostics: {} });
    void laterTicket;

    const age = await store.oldestOpenTicketAgeSeconds(new Date("2026-01-01T01:00:00.000Z"));
    expect(age).toBe(3600);
    void ticket;
  });
});

describe("getSupportTicketsStore", () => {
  it("returns the unconfigured fallback when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    resetSupportTicketsStoreForTests();
    const store = getSupportTicketsStore();
    // Reads must fail loudly rather than degrade to a false-empty queue —
    // a missing DATABASE_URL/unapplied migration must never look like "no
    // tickets" to a user or the admin queue (issue #393 review).
    await expect(store.listForWallet(WALLET)).rejects.toThrow(SupportTicketsStoreUnavailableError);
    await expect(store.listForAdmin("all")).rejects.toThrow(SupportTicketsStoreUnavailableError);
    expect(await store.countOpen()).toBe(0);
    expect(await store.oldestOpenTicketAgeSeconds()).toBeNull();
    await expect(store.create({ walletAddress: WALLET, category: "other", subject: "s", body: "b", diagnostics: {} })).rejects.toThrow(
      SupportTicketsStoreUnavailableError,
    );
  });

  it("returns the test-injected store when one is set", () => {
    const memoryStore = createMemorySupportTicketsStore();
    setSupportTicketsStoreForTests(memoryStore);
    expect(getSupportTicketsStore()).toBe(memoryStore);
  });
});
