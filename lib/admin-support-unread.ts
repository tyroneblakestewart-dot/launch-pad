// Client-side "unread" state for the /admin Support tab (issue #405).
// Admin-only, a single global last-seen timestamp — unlike the per-wallet
// user-side dot in lib/support-unread.ts, there is exactly one owner using
// /admin. Activity means a brand-new ticket or a user follow-up message,
// derived entirely from fields the existing GET /api/admin/support?status=all
// response already returns (ticket.createdAt, and each message's
// author + createdAt) — no new logging table, and this check never reads a
// ticket's body/subject/diagnostics. An owner's own reply or status change
// from /admin never counts as news: it only ever updates ticket.updatedAt
// or adds an "owner"-authored message, neither of which this check reads.

const ADMIN_SUPPORT_LAST_SEEN_STORAGE_KEY = "hoodlums.admin.support.lastSeen.v1";

export type AdminSupportActivityMessage = {
  author: "user" | "owner";
  createdAt: string;
};

export type AdminSupportActivityTicket = {
  createdAt: string;
  messages: AdminSupportActivityMessage[];
};

/** 0 (never seen) when storage is empty, corrupted, or unavailable — never throws into a caller. */
export function readAdminSupportLastSeen(): number {
  try {
    const raw = localStorage.getItem(ADMIN_SUPPORT_LAST_SEEN_STORAGE_KEY);
    if (!raw) return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

/** Best-effort — a private-mode/storage-disabled/quota-exceeded browser (Safari privacy/security exceptions included) just won't clear the dot, it never throws into a caller. */
export function writeAdminSupportLastSeen(timestampMs: number): void {
  try {
    localStorage.setItem(ADMIN_SUPPORT_LAST_SEEN_STORAGE_KEY, String(timestampMs));
  } catch {
    // Ignored — see the best-effort note above.
  }
}

export function hasAdminSupportNews(tickets: AdminSupportActivityTicket[], lastSeenMs: number): boolean {
  return tickets.some((ticket) => {
    const createdMs = Date.parse(ticket.createdAt);
    if (Number.isFinite(createdMs) && createdMs > lastSeenMs) return true;
    return ticket.messages.some((message) => {
      if (message.author !== "user") return false;
      const messageMs = Date.parse(message.createdAt);
      return Number.isFinite(messageMs) && messageMs > lastSeenMs;
    });
  });
}

/**
 * The newest "news-eligible" activity timestamp across an observed ticket
 * listing — a brand-new ticket's `createdAt`, or a `user`-authored message's
 * `createdAt` (issue #405 review). This is exactly the same fields
 * `hasAdminSupportNews` reads, so marking a listing as seen using this value
 * is self-consistent with the check that later decides whether it's news: a
 * ticket/message strictly newer than this boundary is, by construction, one
 * this listing never actually observed. An owner-authored message or a
 * bare status change never advances this boundary, matching
 * `hasAdminSupportNews`.
 */
export function maxAdminSupportActivityMs(tickets: AdminSupportActivityTicket[]): number {
  return tickets.reduce((max, ticket) => {
    const createdMs = Date.parse(ticket.createdAt);
    let ticketMax = Number.isFinite(createdMs) && createdMs > max ? createdMs : max;
    for (const message of ticket.messages) {
      if (message.author !== "user") continue;
      const messageMs = Date.parse(message.createdAt);
      if (Number.isFinite(messageMs) && messageMs > ticketMax) ticketMax = messageMs;
    }
    return ticketMax;
  }, 0);
}
