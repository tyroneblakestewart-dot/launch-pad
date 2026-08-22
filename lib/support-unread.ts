// Client-side "unread" state for support tickets (issue #403). Deliberately
// derived from fields the GET /api/support/tickets response already returns
// (status + updatedAt — see lib/server/support-tickets-store.ts) rather than
// extending that response: a user can never move their own ticket into
// "needs_user" (only an owner reply does that) or "solved" (an admin-only
// status change), so "status is needs_user/solved and updatedAt is newer
// than last-seen" already captures exactly "an owner reply or an
// owner/admin status transition happened since I last looked" without
// conflating it with the user's own reply/close (which move status to
// "open"/"closed", neither of which is checked here).

const SUPPORT_LAST_SEEN_STORAGE_KEY = "hoodlums.support.lastSeen.v1";

export type SupportUnreadTicket = {
  status: "open" | "needs_user" | "solved" | "closed";
  updatedAt: string;
};

function readLastSeenMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SUPPORT_LAST_SEEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

/** 0 (never seen) for an unknown/missing wallet, so every needs_user/solved ticket counts as news the first time. */
export function readSupportLastSeen(walletAddress: string): number {
  if (!walletAddress) return 0;
  const value = readLastSeenMap()[walletAddress.toLowerCase()];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Best-effort — a private-mode/storage-disabled browser just won't clear the dot, it never throws into a caller. */
export function writeSupportLastSeen(walletAddress: string, timestampMs: number): void {
  if (!walletAddress) return;
  try {
    const map = readLastSeenMap();
    map[walletAddress.toLowerCase()] = timestampMs;
    localStorage.setItem(SUPPORT_LAST_SEEN_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignored — see the best-effort note above.
  }
}

export function hasSupportTicketNews(tickets: SupportUnreadTicket[], lastSeenMs: number): boolean {
  return tickets.some((ticket) => {
    if (ticket.status !== "needs_user" && ticket.status !== "solved") return false;
    const updatedAtMs = new Date(ticket.updatedAt).getTime();
    return Number.isFinite(updatedAtMs) && updatedAtMs > lastSeenMs;
  });
}
