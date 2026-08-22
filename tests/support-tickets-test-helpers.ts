import { randomBytes, randomUUID } from "node:crypto";
import {
  isReplyableSupportTicketStatus,
  type AddSupportTicketMessageResult,
  type AddSupportTicketOwnerMessageResult,
  type AnonymousSupportTicketStatusView,
  type CloseSupportTicketByUserResult,
  type CreateAnonymousSupportTicketInput,
  type CreateSupportTicketInput,
  type SetSupportTicketStatusResult,
  type SupportTicket,
  type SupportTicketMessage,
  type SupportTicketsStore,
  type SupportTicketStatus,
  type SupportTicketWithMessages,
} from "@/lib/server/support-tickets-store";

// Mirrors generateSupportTicketReferenceCode's "XXXX-XXXXXX" shape closely
// enough for tests (not cryptographically matched to the real alphabet —
// this double only needs uniqueness, not the real entropy source).
function fakeReferenceCode(): string {
  const raw = randomBytes(6).toString("hex").toUpperCase().slice(0, 10);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// In-memory SupportTicketsStore for tests, mirroring
// tests/social-connections-test-helpers.ts's createMemorySocialConnectionsStore
// pattern: exercises the interface contract without needing a real Postgres
// instance.

export function createMemorySupportTicketsStore(): SupportTicketsStore {
  const tickets = new Map<string, SupportTicket>();
  const messages = new Map<string, SupportTicketMessage[]>();

  function withMessages(ticket: SupportTicket): SupportTicketWithMessages {
    return { ...ticket, messages: messages.get(ticket.id) ?? [] };
  }

  return {
    async create(input: CreateSupportTicketInput) {
      const now = new Date().toISOString();
      const ticket: SupportTicket = {
        id: randomUUID(),
        walletAddress: input.walletAddress,
        referenceCode: null,
        category: input.category,
        subject: input.subject,
        body: input.body,
        status: "open",
        diagnostics: input.diagnostics,
        attachmentDataUrl: input.attachmentDataUrl ?? null,
        createdAt: now,
        updatedAt: now,
      };
      tickets.set(ticket.id, ticket);
      return ticket;
    },

    async createAnonymous(input: CreateAnonymousSupportTicketInput) {
      const now = new Date().toISOString();
      let referenceCode = fakeReferenceCode();
      while ([...tickets.values()].some((t) => t.referenceCode === referenceCode)) {
        referenceCode = fakeReferenceCode();
      }
      const ticket: SupportTicket = {
        id: randomUUID(),
        walletAddress: null,
        referenceCode,
        category: input.category,
        subject: input.subject,
        body: input.body,
        status: "open",
        diagnostics: input.diagnostics,
        attachmentDataUrl: input.attachmentDataUrl ?? null,
        createdAt: now,
        updatedAt: now,
      };
      tickets.set(ticket.id, ticket);
      return ticket;
    },

    async listForWallet(walletAddress: string) {
      return [...tickets.values()]
        .filter((ticket) => ticket.walletAddress?.toLowerCase() === walletAddress.toLowerCase())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(withMessages);
    },

    async addUserMessage(ticketId: string, walletAddress: string, body: string): Promise<AddSupportTicketMessageResult> {
      const ticket = tickets.get(ticketId);
      if (!ticket) return { status: "not_found" };
      if (!ticket.walletAddress || ticket.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return { status: "forbidden" };
      if (!isReplyableSupportTicketStatus(ticket.status)) return { status: "closed" };

      const message: SupportTicketMessage = { id: randomUUID(), ticketId, author: "user", body, createdAt: new Date().toISOString() };
      messages.set(ticketId, [...(messages.get(ticketId) ?? []), message]);
      const updated: SupportTicket = {
        ...ticket,
        status: ticket.status === "needs_user" ? "open" : ticket.status,
        updatedAt: new Date().toISOString(),
      };
      tickets.set(ticketId, updated);
      return { status: "ok", ticket: updated, message };
    },

    async closeTicketByUser(ticketId: string, walletAddress: string): Promise<CloseSupportTicketByUserResult> {
      const ticket = tickets.get(ticketId);
      if (!ticket) return { status: "not_found" };
      if (!ticket.walletAddress || ticket.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return { status: "forbidden" };
      if (!isReplyableSupportTicketStatus(ticket.status)) return { status: "closed" };

      const updated: SupportTicket = { ...ticket, status: "closed", updatedAt: new Date().toISOString() };
      tickets.set(ticketId, updated);
      return { status: "ok", ticket: updated };
    },

    async listForAdmin(status: SupportTicketStatus | "all") {
      return [...tickets.values()]
        .filter((ticket) => status === "all" || ticket.status === status)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(withMessages);
    },

    async addOwnerMessage(ticketId: string, body: string): Promise<AddSupportTicketOwnerMessageResult> {
      const ticket = tickets.get(ticketId);
      if (!ticket) return { status: "not_found" };
      if (!ticket.walletAddress) return { status: "anonymous" };
      if (!isReplyableSupportTicketStatus(ticket.status)) return { status: "closed" };

      const message: SupportTicketMessage = { id: randomUUID(), ticketId, author: "owner", body, createdAt: new Date().toISOString() };
      messages.set(ticketId, [...(messages.get(ticketId) ?? []), message]);
      const updated: SupportTicket = { ...ticket, status: "needs_user", updatedAt: new Date().toISOString() };
      tickets.set(ticketId, updated);
      return { status: "ok", ticket: updated, message };
    },

    async setStatus(ticketId: string, status: SupportTicketStatus): Promise<SetSupportTicketStatusResult> {
      const ticket = tickets.get(ticketId);
      if (!ticket) return { status: "not_found" };
      const updated = { ...ticket, status, updatedAt: new Date().toISOString() };
      tickets.set(ticketId, updated);
      return { status: "ok", ticket: updated };
    },

    async countOpen() {
      return [...tickets.values()].filter((ticket) => ticket.status === "open" || ticket.status === "needs_user").length;
    },

    async oldestOpenTicketAgeSeconds(now: Date = new Date()) {
      const open = [...tickets.values()]
        .filter((ticket) => ticket.status === "open" || ticket.status === "needs_user")
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (open.length === 0) return null;
      return Math.max(0, Math.floor((now.getTime() - new Date(open[0].createdAt).getTime()) / 1000));
    },

    async lookupAnonymousStatus(referenceCode: string): Promise<AnonymousSupportTicketStatusView | null> {
      const ticket = [...tickets.values()].find((t) => t.referenceCode === referenceCode);
      if (!ticket || !ticket.referenceCode) return null;
      return {
        referenceCode: ticket.referenceCode,
        status: ticket.status,
        category: ticket.category,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      };
    },
  };
}
