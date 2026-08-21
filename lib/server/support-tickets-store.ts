import { getPostgresPool } from "@/lib/server/postgres";

// Support tickets, Phase A (issue #393). Mirrors
// lib/server/social-connections-store.ts's shape: interface + unconfigured
// fallback + test-injectable singleton + Postgres implementation. Nothing
// in this module is an AI assistant or auto-answer layer — every reply is
// a human (user or owner) typing into a box. That's Phase B.

export const SUPPORT_TICKET_CATEGORIES = [
  "account",
  "payments",
  "site-builder",
  "social-studio",
  "publishing",
  "other",
] as const;

export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export function isSupportTicketCategory(value: unknown): value is SupportTicketCategory {
  return typeof value === "string" && (SUPPORT_TICKET_CATEGORIES as readonly string[]).includes(value);
}

export const SUPPORT_TICKET_STATUSES = ["open", "needs_user", "solved", "closed"] as const;

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export function isSupportTicketStatus(value: unknown): value is SupportTicketStatus {
  return typeof value === "string" && (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value);
}

/** Statuses a user may still follow up on. Solved/closed tickets are read-only for the user. */
export function isReplyableSupportTicketStatus(status: SupportTicketStatus): boolean {
  return status === "open" || status === "needs_user";
}

export const SUPPORT_TICKET_MESSAGE_AUTHORS = ["user", "owner"] as const;
export type SupportTicketMessageAuthor = (typeof SUPPORT_TICKET_MESSAGE_AUTHORS)[number];

export const MAX_SUPPORT_TICKET_SUBJECT_LENGTH = 200;
export const MAX_SUPPORT_TICKET_BODY_LENGTH = 4000;
export const MAX_SUPPORT_TICKET_MESSAGE_BODY_LENGTH = 4000;
/** Server-side cap on how many of a wallet's own tickets are ever returned in one response. */
export const MAX_SUPPORT_TICKETS_PER_WALLET = 50;
/** Server-side cap on the admin queue listing. */
export const MAX_ADMIN_SUPPORT_TICKETS = 200;

export type SupportTicket = {
  id: string;
  walletAddress: string;
  category: SupportTicketCategory;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  diagnostics: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketMessage = {
  id: string;
  ticketId: string;
  author: SupportTicketMessageAuthor;
  body: string;
  createdAt: string;
};

export type SupportTicketWithMessages = SupportTicket & { messages: SupportTicketMessage[] };

export type CreateSupportTicketInput = {
  walletAddress: string;
  category: SupportTicketCategory;
  subject: string;
  body: string;
  diagnostics: Record<string, unknown>;
};

export type AddSupportTicketMessageResult =
  | { status: "ok"; ticket: SupportTicket; message: SupportTicketMessage }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "closed" };

export type SetSupportTicketStatusResult =
  | { status: "ok"; ticket: SupportTicket }
  | { status: "not_found" };

export interface SupportTicketsStore {
  create(input: CreateSupportTicketInput): Promise<SupportTicket>;
  listForWallet(walletAddress: string): Promise<SupportTicketWithMessages[]>;
  /** Rejects with "forbidden" when the ticket belongs to a different wallet, "closed" when solved/closed. */
  addUserMessage(ticketId: string, walletAddress: string, body: string): Promise<AddSupportTicketMessageResult>;
  listForAdmin(status: SupportTicketStatus | "all"): Promise<SupportTicketWithMessages[]>;
  /** Also flips the ticket's status to 'needs_user'. */
  addOwnerMessage(ticketId: string, body: string): Promise<{ status: "ok"; ticket: SupportTicket; message: SupportTicketMessage } | { status: "not_found" }>;
  setStatus(ticketId: string, status: SupportTicketStatus): Promise<SetSupportTicketStatusResult>;
  countOpen(): Promise<number>;
  /** Age in seconds of the oldest open-or-needs_user ticket, or null when there are none. */
  oldestOpenTicketAgeSeconds(now?: Date): Promise<number | null>;
}

export class SupportTicketsStoreUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured for support tickets.");
    this.name = "SupportTicketsStoreUnavailableError";
  }
}

const unconfiguredStore: SupportTicketsStore = {
  async create() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async listForWallet() {
    return [];
  },
  async addUserMessage() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async listForAdmin() {
    return [];
  },
  async addOwnerMessage() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async setStatus() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async countOpen() {
    return 0;
  },
  async oldestOpenTicketAgeSeconds() {
    return null;
  },
};

let testStore: SupportTicketsStore | null = null;
let productionStore: SupportTicketsStore | null = null;
let productionDatabaseUrl = "";

export function setSupportTicketsStoreForTests(store: SupportTicketsStore): void {
  testStore = store;
}

export function resetSupportTicketsStoreForTests(): void {
  testStore = null;
}

export function getSupportTicketsStore(): SupportTicketsStore {
  if (testStore) return testStore;

  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!databaseUrl) return unconfiguredStore;
  if (!productionStore || productionDatabaseUrl !== databaseUrl) {
    productionStore = createPostgresSupportTicketsStore(databaseUrl);
    productionDatabaseUrl = databaseUrl;
  }
  return productionStore;
}

type TicketRow = {
  id: string;
  wallet_address: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  diagnostics: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type MessageRow = {
  id: string;
  ticket_id: string;
  author: string;
  body: string;
  created_at: Date | string;
};

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function diagnosticsFromValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function ticketFromRow(row: TicketRow): SupportTicket | null {
  if (!isSupportTicketCategory(row.category) || !isSupportTicketStatus(row.status)) return null;
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    category: row.category,
    subject: row.subject,
    body: row.body,
    status: row.status,
    diagnostics: diagnosticsFromValue(row.diagnostics),
    createdAt: asDate(row.created_at).toISOString(),
    updatedAt: asDate(row.updated_at).toISOString(),
  };
}

function messageFromRow(row: MessageRow): SupportTicketMessage | null {
  if (row.author !== "user" && row.author !== "owner") return null;
  return {
    id: row.id,
    ticketId: row.ticket_id,
    author: row.author,
    body: row.body,
    createdAt: asDate(row.created_at).toISOString(),
  };
}

const TICKET_COLUMNS = `id, wallet_address, category, subject, body, status, diagnostics, created_at, updated_at`;
const MESSAGE_COLUMNS = `id, ticket_id, author, body, created_at`;

export function createPostgresSupportTicketsStore(databaseUrl: string): SupportTicketsStore {
  const pool = getPostgresPool(databaseUrl);

  async function messagesForTickets(ticketIds: string[]): Promise<Map<string, SupportTicketMessage[]>> {
    const byTicket = new Map<string, SupportTicketMessage[]>();
    if (ticketIds.length === 0) return byTicket;
    const result = await pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM support_ticket_messages WHERE ticket_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [ticketIds],
    );
    for (const row of result.rows) {
      const message = messageFromRow(row);
      if (!message) continue;
      const list = byTicket.get(message.ticketId) ?? [];
      list.push(message);
      byTicket.set(message.ticketId, list);
    }
    return byTicket;
  }

  async function ticketsWithMessages(rows: TicketRow[]): Promise<SupportTicketWithMessages[]> {
    const tickets = rows.map(ticketFromRow).filter((ticket): ticket is SupportTicket => ticket !== null);
    const messagesByTicket = await messagesForTickets(tickets.map((ticket) => ticket.id));
    return tickets.map((ticket) => ({ ...ticket, messages: messagesByTicket.get(ticket.id) ?? [] }));
  }

  return {
    async create(input) {
      const result = await pool.query<TicketRow>(
        `INSERT INTO support_tickets (wallet_address, category, subject, body, diagnostics)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING ${TICKET_COLUMNS}`,
        [input.walletAddress, input.category, input.subject, input.body, JSON.stringify(input.diagnostics)],
      );
      const row = result.rows[0];
      const ticket = row ? ticketFromRow(row) : null;
      if (!ticket) throw new Error("The support ticket could not be created.");
      return ticket;
    },

    async listForWallet(walletAddress) {
      const result = await pool.query<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM support_tickets
          WHERE LOWER(wallet_address) = LOWER($1)
          ORDER BY created_at DESC
          LIMIT $2`,
        [walletAddress, MAX_SUPPORT_TICKETS_PER_WALLET],
      );
      return ticketsWithMessages(result.rows);
    },

    async addUserMessage(ticketId, walletAddress, body) {
      const ticketResult = await pool.query<TicketRow>(
        `SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE id = $1`,
        [ticketId],
      );
      const row = ticketResult.rows[0];
      const ticket = row ? ticketFromRow(row) : null;
      if (!ticket) return { status: "not_found" };
      if (ticket.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) return { status: "forbidden" };
      if (!isReplyableSupportTicketStatus(ticket.status)) return { status: "closed" };

      const messageResult = await pool.query<MessageRow>(
        `INSERT INTO support_ticket_messages (ticket_id, author, body) VALUES ($1, 'user', $2) RETURNING ${MESSAGE_COLUMNS}`,
        [ticketId, body],
      );
      const message = messageFromRow(messageResult.rows[0]);
      if (!message) throw new Error("The support ticket reply could not be saved.");

      const updatedResult = await pool.query<TicketRow>(
        `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1 RETURNING ${TICKET_COLUMNS}`,
        [ticketId],
      );
      const updatedTicket = ticketFromRow(updatedResult.rows[0]) ?? ticket;
      return { status: "ok", ticket: updatedTicket, message };
    },

    async listForAdmin(status) {
      const result =
        status === "all"
          ? await pool.query<TicketRow>(
              `SELECT ${TICKET_COLUMNS} FROM support_tickets ORDER BY created_at DESC LIMIT $1`,
              [MAX_ADMIN_SUPPORT_TICKETS],
            )
          : await pool.query<TicketRow>(
              `SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
              [status, MAX_ADMIN_SUPPORT_TICKETS],
            );
      return ticketsWithMessages(result.rows);
    },

    async addOwnerMessage(ticketId, body) {
      const ticketResult = await pool.query<TicketRow>(`SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE id = $1`, [ticketId]);
      if (!ticketResult.rows[0]) return { status: "not_found" };

      const messageResult = await pool.query<MessageRow>(
        `INSERT INTO support_ticket_messages (ticket_id, author, body) VALUES ($1, 'owner', $2) RETURNING ${MESSAGE_COLUMNS}`,
        [ticketId, body],
      );
      const message = messageFromRow(messageResult.rows[0]);
      if (!message) throw new Error("The support ticket reply could not be saved.");

      const updatedResult = await pool.query<TicketRow>(
        `UPDATE support_tickets SET status = 'needs_user', updated_at = NOW() WHERE id = $1 RETURNING ${TICKET_COLUMNS}`,
        [ticketId],
      );
      const ticket = ticketFromRow(updatedResult.rows[0]);
      if (!ticket) throw new Error("The support ticket could not be updated.");
      return { status: "ok", ticket, message };
    },

    async setStatus(ticketId, status) {
      const result = await pool.query<TicketRow>(
        `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING ${TICKET_COLUMNS}`,
        [ticketId, status],
      );
      const ticket = result.rows[0] ? ticketFromRow(result.rows[0]) : null;
      if (!ticket) return { status: "not_found" };
      return { status: "ok", ticket };
    },

    async countOpen() {
      const result = await pool.query<{ count: number | string }>(
        `SELECT COUNT(*)::int AS count FROM support_tickets WHERE status IN ('open', 'needs_user')`,
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async oldestOpenTicketAgeSeconds(now = new Date()) {
      const result = await pool.query<{ created_at: Date | string | null }>(
        `SELECT created_at FROM support_tickets WHERE status IN ('open', 'needs_user') ORDER BY created_at ASC LIMIT 1`,
      );
      const createdAt = result.rows[0]?.created_at;
      if (!createdAt) return null;
      return Math.max(0, Math.floor((now.getTime() - asDate(createdAt).getTime()) / 1000));
    },
  };
}
