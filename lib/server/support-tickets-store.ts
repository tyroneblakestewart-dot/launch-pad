import { randomInt } from "node:crypto";
import type { PoolClient } from "pg";
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
/** Server-side cap on how many of a single ticket's messages are ever returned in one response. */
export const MAX_SUPPORT_TICKET_MESSAGES_PER_TICKET = 200;

const SUPPORT_TICKET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict UUID shape check shared by every route that takes a ticket id from a URL/body, so a malformed id 400s before it ever reaches an auth check or a Postgres uuid-column comparison. */
export function isValidSupportTicketId(value: unknown): value is string {
  return typeof value === "string" && SUPPORT_TICKET_ID_PATTERN.test(value);
}

export type SupportTicket = {
  id: string;
  /** Null for an anonymous ticket (issue #405) — exactly one of walletAddress/referenceCode is ever set, enforced by a DB CHECK constraint. */
  walletAddress: string | null;
  /** Null for a signed (wallet-owned) ticket. Set for an anonymous ticket — its only way to check status later, since it has no wallet to authenticate with. */
  referenceCode: string | null;
  category: SupportTicketCategory;
  subject: string;
  body: string;
  status: SupportTicketStatus;
  diagnostics: Record<string, unknown>;
  /** A single optional screenshot data URL attached at creation (issue #398). Never set on follow-up messages — those stay text-only. */
  attachmentDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

// Anonymous reporting reference codes (issue #405). Human-quotable
// "XXXX-XXXXXX" format from a 31-symbol alphabet excluding visually
// ambiguous characters (0/O, 1/I/L) — about 49.5 bits of node:crypto
// randomness per code (31^10 combinations), generated server-side only,
// never derived from body/wallet/IP.
const REFERENCE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REFERENCE_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{6}$/;

function generateSupportTicketReferenceCode(): string {
  let raw = "";
  for (let index = 0; index < 10; index += 1) {
    raw += REFERENCE_CODE_ALPHABET[randomInt(REFERENCE_CODE_ALPHABET.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Normalises user-supplied input (case, whitespace) for a reference-code lookup; returns null for anything that doesn't match the stored shape, so an obviously-invalid code never even reaches a query. */
export function normaliseSupportTicketReferenceCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return REFERENCE_CODE_PATTERN.test(upper) ? upper : null;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23505");
}

export type SupportTicketMessage = {
  id: string;
  ticketId: string;
  author: SupportTicketMessageAuthor;
  body: string;
  createdAt: string;
};

export type SupportTicketWithMessages = SupportTicket & { messages: SupportTicketMessage[] };

/**
 * What a wallet-signed public response is allowed to echo back about its own
 * ticket — never `diagnostics` (assembled for the owner's eyes only) or the
 * raw `walletAddress` (issue #393 review). Every public support route
 * (create/list/reply) must project through this, never return the full
 * store `SupportTicket`/`SupportTicketWithMessages` shape directly.
 */
export type PublicSupportTicket = Omit<SupportTicket, "diagnostics" | "walletAddress">;

export function toPublicSupportTicket<T extends SupportTicket>(ticket: T): Omit<T, "diagnostics" | "walletAddress"> {
  const { diagnostics: _diagnostics, walletAddress: _walletAddress, ...rest } = ticket;
  void _diagnostics;
  void _walletAddress;
  return rest;
}

export type CreateSupportTicketInput = {
  walletAddress: string;
  category: SupportTicketCategory;
  subject: string;
  body: string;
  diagnostics: Record<string, unknown>;
  /** Already validated (mime allowlist + byte cap) by the caller — see lib/server/support-ticket-attachment.ts. Optional/omittable for "no attachment", same as null. */
  attachmentDataUrl?: string | null;
};

/** No walletAddress — an anonymous ticket has none. diagnostics must stay minimal (issue #405): never a plan/subscription or social-connection lookup, since there's no wallet to check either against. */
export type CreateAnonymousSupportTicketInput = {
  category: SupportTicketCategory;
  subject: string;
  body: string;
  diagnostics: Record<string, unknown>;
  attachmentDataUrl?: string | null;
};

/** The only fields a status-only reference-code lookup is ever allowed to return — never body, subject, attachment, diagnostics, messages or wallet (issue #405). */
export type AnonymousSupportTicketStatusView = {
  referenceCode: string;
  status: SupportTicketStatus;
  category: SupportTicketCategory;
  createdAt: string;
  updatedAt: string;
};

export type AddSupportTicketMessageResult =
  | { status: "ok"; ticket: SupportTicket; message: SupportTicketMessage }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "closed" };

/**
 * No "forbidden" case — the owner isn't scoped to a single wallet's ticket.
 * "anonymous" rejects a reply attempt on a wallet-less ticket (issue #405):
 * an anonymous reporter has no wallet to authenticate with, so it can never
 * read a reply — the ticket must not gain a thread.
 */
export type AddSupportTicketOwnerMessageResult =
  | { status: "ok"; ticket: SupportTicket; message: SupportTicketMessage }
  | { status: "not_found" }
  | { status: "closed" }
  | { status: "anonymous" };

export type SetSupportTicketStatusResult =
  | { status: "ok"; ticket: SupportTicket }
  | { status: "not_found" };

export type CloseSupportTicketByUserResult =
  | { status: "ok"; ticket: SupportTicket }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "closed" };

export interface SupportTicketsStore {
  create(input: CreateSupportTicketInput): Promise<SupportTicket>;
  /** Anonymous/no-wallet creation (issue #405) — generates and returns a unique referenceCode server-side; retries internally on a random collision. */
  createAnonymous(input: CreateAnonymousSupportTicketInput): Promise<SupportTicket>;
  listForWallet(walletAddress: string): Promise<SupportTicketWithMessages[]>;
  /** Rejects with "forbidden" when the ticket belongs to a different wallet, "closed" when solved/closed. */
  addUserMessage(ticketId: string, walletAddress: string, body: string): Promise<AddSupportTicketMessageResult>;
  /** A user closing their own open/needs_user ticket. Rejects with "forbidden" for a different wallet's ticket, "closed" when already solved/closed — a terminal ticket can't be re-closed. */
  closeTicketByUser(ticketId: string, walletAddress: string): Promise<CloseSupportTicketByUserResult>;
  listForAdmin(status: SupportTicketStatus | "all"): Promise<SupportTicketWithMessages[]>;
  /** Also flips the ticket's status to 'needs_user'. Rejects with "closed" for a solved/closed ticket rather than implicitly reopening it, "anonymous" for a wallet-less ticket. */
  addOwnerMessage(ticketId: string, body: string): Promise<AddSupportTicketOwnerMessageResult>;
  setStatus(ticketId: string, status: SupportTicketStatus): Promise<SetSupportTicketStatusResult>;
  countOpen(): Promise<number>;
  /** Age in seconds of the oldest open-or-needs_user ticket, or null when there are none. */
  oldestOpenTicketAgeSeconds(now?: Date): Promise<number | null>;
  /** Bounded status-only lookup by normalised reference code (issue #405) — never returns body/subject/attachment/diagnostics/messages/wallet. Null for an unknown or malformed code. */
  lookupAnonymousStatus(referenceCode: string): Promise<AnonymousSupportTicketStatusView | null>;
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
  async createAnonymous() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async listForWallet() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async addUserMessage() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async closeTicketByUser() {
    throw new SupportTicketsStoreUnavailableError();
  },
  async listForAdmin() {
    throw new SupportTicketsStoreUnavailableError();
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
  async lookupAnonymousStatus() {
    throw new SupportTicketsStoreUnavailableError();
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
  wallet_address: string | null;
  reference_code: string | null;
  category: string;
  subject: string;
  body: string;
  status: string;
  diagnostics: unknown;
  attachment_data_url: string | null;
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
    walletAddress: row.wallet_address ?? null,
    referenceCode: row.reference_code ?? null,
    category: row.category,
    subject: row.subject,
    body: row.body,
    status: row.status,
    diagnostics: diagnosticsFromValue(row.diagnostics),
    attachmentDataUrl: row.attachment_data_url ?? null,
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

const TICKET_COLUMNS = `id, wallet_address, reference_code, category, subject, body, status, diagnostics, attachment_data_url, created_at, updated_at`;
const MESSAGE_COLUMNS = `id, ticket_id, author, body, created_at`;

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original error/result from the caller.
  }
}

export function createPostgresSupportTicketsStore(databaseUrl: string): SupportTicketsStore {
  const pool = getPostgresPool(databaseUrl);

  async function messagesForTickets(ticketIds: string[]): Promise<Map<string, SupportTicketMessage[]>> {
    const byTicket = new Map<string, SupportTicketMessage[]>();
    if (ticketIds.length === 0) return byTicket;
    // Bounded per ticket via ROW_NUMBER rather than a flat LIMIT, so a single
    // noisy thread can't crowd out every other ticket's messages in this
    // batch read; the final ORDER BY keeps each ticket's retained messages
    // in chronological (oldest-first) display order.
    const result = await pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM (
         SELECT ${MESSAGE_COLUMNS},
                ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY created_at DESC) AS rn
           FROM support_ticket_messages
          WHERE ticket_id = ANY($1::uuid[])
       ) ranked
       WHERE rn <= $2
       ORDER BY ticket_id, created_at ASC`,
      [ticketIds, MAX_SUPPORT_TICKET_MESSAGES_PER_TICKET],
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
        `INSERT INTO support_tickets (wallet_address, reference_code, category, subject, body, diagnostics, attachment_data_url)
         VALUES ($1, NULL, $2, $3, $4, $5::jsonb, $6)
         RETURNING ${TICKET_COLUMNS}`,
        [input.walletAddress, input.category, input.subject, input.body, JSON.stringify(input.diagnostics), input.attachmentDataUrl ?? null],
      );
      const row = result.rows[0];
      const ticket = row ? ticketFromRow(row) : null;
      if (!ticket) throw new Error("The support ticket could not be created.");
      return ticket;
    },

    async createAnonymous(input) {
      // Retries on a random reference-code collision (astronomically
      // unlikely given ~49.5 bits of randomness per code, but handled
      // rather than assumed away) — bounded so a persistently broken unique
      // index still fails loudly instead of looping forever.
      const MAX_ATTEMPTS = 5;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const referenceCode = generateSupportTicketReferenceCode();
        try {
          const result = await pool.query<TicketRow>(
            `INSERT INTO support_tickets (wallet_address, reference_code, category, subject, body, diagnostics, attachment_data_url)
             VALUES (NULL, $1, $2, $3, $4, $5::jsonb, $6)
             RETURNING ${TICKET_COLUMNS}`,
            [referenceCode, input.category, input.subject, input.body, JSON.stringify(input.diagnostics), input.attachmentDataUrl ?? null],
          );
          const row = result.rows[0];
          const ticket = row ? ticketFromRow(row) : null;
          if (!ticket) throw new Error("The anonymous support ticket could not be created.");
          return ticket;
        } catch (error) {
          if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS - 1) continue;
          throw error;
        }
      }
      throw new Error("A unique reference code could not be generated. Try again.");
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
      // Locks the ticket row for the whole read-check-write so a concurrent
      // owner reply or status change can't land between the status check and
      // the insert (issue #393 review) — the transaction either commits the
      // message + updated_at together or rolls back and nothing is persisted.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ticketResult = await client.query<TicketRow>(
          `SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE id = $1 FOR UPDATE`,
          [ticketId],
        );
        const row = ticketResult.rows[0];
        const ticket = row ? ticketFromRow(row) : null;
        if (!ticket) {
          await rollback(client);
          return { status: "not_found" };
        }
        // An anonymous ticket (walletAddress null) can never match a
        // wallet-signed caller — it falls through to "forbidden" here, the
        // same as any other wallet's ticket (issue #405: anonymous tickets
        // must not gain a thread).
        if (!ticket.walletAddress || ticket.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          await rollback(client);
          return { status: "forbidden" };
        }
        if (!isReplyableSupportTicketStatus(ticket.status)) {
          await rollback(client);
          return { status: "closed" };
        }

        const messageResult = await client.query<MessageRow>(
          `INSERT INTO support_ticket_messages (ticket_id, author, body) VALUES ($1, 'user', $2) RETURNING ${MESSAGE_COLUMNS}`,
          [ticketId, body],
        );
        const message = messageFromRow(messageResult.rows[0]);
        if (!message) throw new Error("The support ticket reply could not be saved.");

        // A user follow-up clears any pending "needs_user" flag back to
        // "open" — otherwise the admin queue would keep showing a ticket the
        // user already responded to as still waiting on them.
        const updatedResult = await client.query<TicketRow>(
          `UPDATE support_tickets
              SET status = CASE WHEN status = 'needs_user' THEN 'open' ELSE status END,
                  updated_at = NOW()
            WHERE id = $1
        RETURNING ${TICKET_COLUMNS}`,
          [ticketId],
        );
        const updatedTicket = updatedResult.rows[0] ? ticketFromRow(updatedResult.rows[0]) : null;
        if (!updatedTicket) throw new Error("The support ticket could not be updated.");
        await client.query("COMMIT");
        return { status: "ok", ticket: updatedTicket, message };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
    },

    async closeTicketByUser(ticketId, walletAddress) {
      // Same locked read-check-write shape as addUserMessage, minus the
      // message insert — a user close is a pure status transition.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ticketResult = await client.query<TicketRow>(
          `SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE id = $1 FOR UPDATE`,
          [ticketId],
        );
        const row = ticketResult.rows[0];
        const ticket = row ? ticketFromRow(row) : null;
        if (!ticket) {
          await rollback(client);
          return { status: "not_found" };
        }
        // An anonymous ticket (walletAddress null) can never match a
        // wallet-signed caller — same reasoning as addUserMessage above.
        if (!ticket.walletAddress || ticket.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          await rollback(client);
          return { status: "forbidden" };
        }
        if (!isReplyableSupportTicketStatus(ticket.status)) {
          await rollback(client);
          return { status: "closed" };
        }

        const updatedResult = await client.query<TicketRow>(
          `UPDATE support_tickets SET status = 'closed', updated_at = NOW() WHERE id = $1 RETURNING ${TICKET_COLUMNS}`,
          [ticketId],
        );
        const updatedTicket = updatedResult.rows[0] ? ticketFromRow(updatedResult.rows[0]) : null;
        if (!updatedTicket) throw new Error("The support ticket could not be closed.");
        await client.query("COMMIT");
        return { status: "ok", ticket: updatedTicket };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
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
      // Same locked read-check-write shape as addUserMessage. A solved/closed
      // ticket is rejected rather than silently reopened by an owner reply —
      // the admin route/UI surface that as a 409, matching a user's own
      // reply being rejected on a terminal ticket.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ticketResult = await client.query<TicketRow>(
          `SELECT ${TICKET_COLUMNS} FROM support_tickets WHERE id = $1 FOR UPDATE`,
          [ticketId],
        );
        const row = ticketResult.rows[0];
        const ticket = row ? ticketFromRow(row) : null;
        if (!ticket) {
          await rollback(client);
          return { status: "not_found" };
        }
        // An anonymous ticket has no wallet to authenticate a reply read
        // with — reject rather than silently writing a message the
        // reporter can never see (issue #405: anonymous tickets must not
        // gain a thread). Checked before the status check so this reason is
        // surfaced even on an otherwise-replyable anonymous ticket.
        if (!ticket.walletAddress) {
          await rollback(client);
          return { status: "anonymous" };
        }
        if (!isReplyableSupportTicketStatus(ticket.status)) {
          await rollback(client);
          return { status: "closed" };
        }

        const messageResult = await client.query<MessageRow>(
          `INSERT INTO support_ticket_messages (ticket_id, author, body) VALUES ($1, 'owner', $2) RETURNING ${MESSAGE_COLUMNS}`,
          [ticketId, body],
        );
        const message = messageFromRow(messageResult.rows[0]);
        if (!message) throw new Error("The support ticket reply could not be saved.");

        const updatedResult = await client.query<TicketRow>(
          `UPDATE support_tickets SET status = 'needs_user', updated_at = NOW() WHERE id = $1 RETURNING ${TICKET_COLUMNS}`,
          [ticketId],
        );
        const updatedTicket = ticketFromRow(updatedResult.rows[0]);
        if (!updatedTicket) throw new Error("The support ticket could not be updated.");
        await client.query("COMMIT");
        return { status: "ok", ticket: updatedTicket, message };
      } catch (error) {
        await rollback(client);
        throw error;
      } finally {
        client.release();
      }
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

    async lookupAnonymousStatus(referenceCode) {
      // Bounded projection at the query level, not just in the return type —
      // body/subject/attachment/diagnostics never leave Postgres for this
      // lookup (issue #405).
      const result = await pool.query<{
        reference_code: string | null;
        status: string;
        category: string;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `SELECT reference_code, status, category, created_at, updated_at
           FROM support_tickets
          WHERE reference_code = $1
          LIMIT 1`,
        [referenceCode],
      );
      const row = result.rows[0];
      if (!row || !row.reference_code || !isSupportTicketCategory(row.category) || !isSupportTicketStatus(row.status)) {
        return null;
      }
      return {
        referenceCode: row.reference_code,
        status: row.status,
        category: row.category,
        createdAt: asDate(row.created_at).toISOString(),
        updatedAt: asDate(row.updated_at).toISOString(),
      };
    },
  };
}
