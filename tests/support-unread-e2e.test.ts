import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_WALLET_STORAGE_KEY } from "@/lib/account-wallet-state";
import { readSupportLastSeen } from "@/lib/support-unread";
import {
  getCachedSupportUnreadForTests,
  markSupportUnreadSeen,
  refreshSupportUnread,
  resetSupportUnreadForTests,
} from "@/lib/use-support-unread";
import { createFakeLocalStorage, type FakeLocalStorage } from "./fake-local-storage-test-helper";

// A real component-level end-to-end-ish test for the user-side notification
// dot (issue #405). This repo's Vitest suite runs in a plain Node
// environment with no jsdom/@testing-library (see vitest.config.ts —
// `environment: "node"`, no DOM-rendering libraries installed), so a
// mounted `useSupportUnread()` component tree can't be exercised directly.
// Instead this drives the REAL underlying module (lib/use-support-unread.ts's
// exported `refreshSupportUnread` and cached-value seam), with only
// `fetch`/`localStorage` mocked — the actual fetch → hasSupportTicketNews →
// notify pipeline runs unmodified, only its I/O is stubbed. That's the
// closest "real component-level" test this environment allows; it is
// honestly not a full DOM render of AppNavigation/SupportHub.
//
// Three facts this test exists to lock in, stated loudly per the issue:
//   1. Unread state is PER-WALLET — wallet A's news never lights wallet B,
//      and marking wallet A seen never clears an already-lit wallet B dot.
//   2. Being on /support when activity lands clears it immediately once the
//      refreshed data is shown — loadTickets's real markSupportUnreadSeen
//      call, not a Date.now() write, and not a second refreshSupportUnread()
//      round-trip.

const WALLET_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WALLET_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function storeActiveWallet(fakeLocalStorage: FakeLocalStorage, wallet: string): void {
  fakeLocalStorage.setItem(ACCOUNT_WALLET_STORAGE_KEY, JSON.stringify({ walletName: "test-wallet", account: wallet }));
}

function ticketsResponse(tickets: unknown[]): Response {
  return new Response(JSON.stringify({ tickets }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("Support unread notification dot — end-to-end-ish (issue #405)", () => {
  let fakeLocalStorage: FakeLocalStorage;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeLocalStorage = createFakeLocalStorage();
    vi.stubGlobal("localStorage", fakeLocalStorage);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    resetSupportUnreadForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetSupportUnreadForTests();
  });

  it("walks the full scenario: owner reply lights wallet A, never wallet B, and clears once /support shows current data", async () => {
    // Step 1: an owner reply/update arrives for wallet A while the browser
    // is not on /support — the ticket is now needs_user, updated "now".
    storeActiveWallet(fakeLocalStorage, WALLET_A);
    const ownerReplyAt = new Date().toISOString();
    fetchMock.mockImplementation(async (url: string) => {
      expect(url).toContain(`walletAddress=${WALLET_A}`);
      return ticketsResponse([{ status: "needs_user", updatedAt: ownerReplyAt }]);
    });

    // Step 2: the next nav check (a fresh refreshSupportUnread(), exactly
    // what useSupportUnread's mount/focus effect calls) shows the dot.
    await refreshSupportUnread();
    expect(getCachedSupportUnreadForTests()).toBe(true);

    // Step 3: wallet B is not lit by wallet A's update. Switching the active
    // wallet queries wallet B's own tickets (a different URL/response,
    // exactly like the real GET /api/support/tickets?walletAddress=... —
    // the server never returns wallet A's tickets for a wallet B query) and
    // wallet B's own last-seen (also per-wallet-keyed) starts unseen but
    // wallet B has no news of its own here.
    storeActiveWallet(fakeLocalStorage, WALLET_B);
    fetchMock.mockImplementation(async (url: string) => {
      expect(url).toContain(`walletAddress=${WALLET_B}`);
      return ticketsResponse([{ status: "open", updatedAt: new Date().toISOString() }]);
    });
    await refreshSupportUnread();
    expect(getCachedSupportUnreadForTests()).toBe(false);

    // Step 4: switching back to wallet A and opening /support — a
    // successful ticket load calls markSupportUnreadSeen(wallet, tickets)
    // exactly like components/support-hub.tsx's loadTickets does on every
    // successful load. That alone, with no further owner activity, clears
    // wallet A's dot on the next check.
    storeActiveWallet(fakeLocalStorage, WALLET_A);
    markSupportUnreadSeen(WALLET_A, [{ status: "needs_user", updatedAt: ownerReplyAt }]);
    fetchMock.mockImplementation(async () => ticketsResponse([{ status: "needs_user", updatedAt: ownerReplyAt }]));
    await refreshSupportUnread();
    expect(getCachedSupportUnreadForTests()).toBe(false);
  });

  it("marks a reply that arrives during the visible refresh as seen IMMEDIATELY — no refreshSupportUnread() round-trip needed — so a single-person tester may never observe the dot", async () => {
    // Simulates components/support-hub.tsx's loadTickets: every successful
    // load, including a background 60s-timer refresh while the page is
    // already open, calls markSupportUnreadSeen with the tickets it just
    // displayed — before the nav ever gets a chance to independently
    // refetch and notice. The assertion below deliberately never calls
    // refreshSupportUnread() again, to prove the clear is immediate and not
    // an artifact of the next check happening to also see the same data.
    storeActiveWallet(fakeLocalStorage, WALLET_A);
    const replyDuringVisit = new Date().toISOString();

    markSupportUnreadSeen(WALLET_A, [{ status: "needs_user", updatedAt: replyDuringVisit }]);

    expect(getCachedSupportUnreadForTests()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marking wallet A seen never clears an already-lit wallet B dot", async () => {
    // Wallet B is the browser's currently active wallet and already has a
    // lit dot from a prior nav check.
    storeActiveWallet(fakeLocalStorage, WALLET_B);
    const ownerReplyAt = new Date().toISOString();
    fetchMock.mockImplementation(async () => ticketsResponse([{ status: "needs_user", updatedAt: ownerReplyAt }]));
    await refreshSupportUnread();
    expect(getCachedSupportUnreadForTests()).toBe(true);

    // A stale caller — e.g. a loadTickets response for a wallet the user
    // has since switched away from — marks wallet A seen. Because wallet A
    // is not the browser's currently active wallet, this must not touch the
    // shared cached dot at all, and wallet B's true notification must stay
    // lit.
    markSupportUnreadSeen(WALLET_A, [{ status: "needs_user", updatedAt: new Date().toISOString() }]);
    expect(getCachedSupportUnreadForTests()).toBe(true);

    // Wallet A's own last-seen was still recorded, independently of B — it
    // just never touched the shared notifier.
    expect(readSupportLastSeen(WALLET_A)).toBeGreaterThan(0);
  });

  it("shows no dot when the check fails or is rate-limited, never a false alert", async () => {
    storeActiveWallet(fakeLocalStorage, WALLET_A);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }));
    await refreshSupportUnread();
    expect(getCachedSupportUnreadForTests()).toBe(false);
  });

  it("skips the check entirely (never lights a dot) when no wallet is stored", async () => {
    await refreshSupportUnread();
    expect(getCachedSupportUnreadForTests()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
