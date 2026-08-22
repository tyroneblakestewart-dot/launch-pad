import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasSupportTicketNews, readSupportLastSeen, writeSupportLastSeen } from "@/lib/support-unread";
import { createFakeLocalStorage, type FakeLocalStorage } from "./fake-local-storage-test-helper";

const WALLET = "0xAbC1230000000000000000000000000000dEaD";

describe("hasSupportTicketNews (issue #403)", () => {
  it("flags a ticket whose owner reply moved it to needs_user after last-seen", () => {
    const tickets = [{ status: "needs_user" as const, updatedAt: "2026-08-22T10:00:00.000Z" }];
    expect(hasSupportTicketNews(tickets, Date.parse("2026-08-22T09:00:00.000Z"))).toBe(true);
  });

  it("flags a ticket an admin marked solved after last-seen", () => {
    const tickets = [{ status: "solved" as const, updatedAt: "2026-08-22T10:00:00.000Z" }];
    expect(hasSupportTicketNews(tickets, Date.parse("2026-08-22T09:00:00.000Z"))).toBe(true);
  });

  it("does not flag a needs_user/solved ticket already seen (updatedAt before last-seen)", () => {
    const tickets = [{ status: "needs_user" as const, updatedAt: "2026-08-22T08:00:00.000Z" }];
    expect(hasSupportTicketNews(tickets, Date.parse("2026-08-22T09:00:00.000Z"))).toBe(false);
  });

  it("does not flag the user's own reply (moves status to open) or their own close (moves status to closed)", () => {
    const lastSeen = Date.parse("2026-08-22T09:00:00.000Z");
    const afterOwnReply = [{ status: "open" as const, updatedAt: "2026-08-22T10:00:00.000Z" }];
    const afterOwnClose = [{ status: "closed" as const, updatedAt: "2026-08-22T10:00:00.000Z" }];
    expect(hasSupportTicketNews(afterOwnReply, lastSeen)).toBe(false);
    expect(hasSupportTicketNews(afterOwnClose, lastSeen)).toBe(false);
  });

  it("treats never-seen (last-seen 0) as news for any current needs_user/solved ticket", () => {
    const tickets = [{ status: "solved" as const, updatedAt: "2020-01-01T00:00:00.000Z" }];
    expect(hasSupportTicketNews(tickets, 0)).toBe(true);
  });

  it("ignores a malformed updatedAt instead of throwing", () => {
    const tickets = [{ status: "needs_user" as const, updatedAt: "not-a-date" }];
    expect(hasSupportTicketNews(tickets, 0)).toBe(false);
  });
});

describe("support last-seen storage (issue #403)", () => {
  let fakeLocalStorage: FakeLocalStorage;

  beforeEach(() => {
    fakeLocalStorage = createFakeLocalStorage();
    vi.stubGlobal("localStorage", fakeLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 0 for a wallet that has never been recorded", () => {
    expect(readSupportLastSeen(WALLET)).toBe(0);
  });

  it("round-trips a written timestamp, keyed case-insensitively by wallet", () => {
    writeSupportLastSeen(WALLET, 1_700_000_000_000);
    expect(readSupportLastSeen(WALLET.toLowerCase())).toBe(1_700_000_000_000);
    expect(readSupportLastSeen(WALLET.toUpperCase())).toBe(1_700_000_000_000);
  });

  it("keeps separate wallets' last-seen values independent", () => {
    const otherWallet = "0x00000000000000000000000000000000000BEE";
    writeSupportLastSeen(WALLET, 1000);
    writeSupportLastSeen(otherWallet, 2000);
    expect(readSupportLastSeen(WALLET)).toBe(1000);
    expect(readSupportLastSeen(otherWallet)).toBe(2000);
  });

  it("never throws when storage.setItem fails, and leaves the previous value alone", () => {
    writeSupportLastSeen(WALLET, 1000);
    fakeLocalStorage.failNextSetItemWith = new Error("quota exceeded");
    expect(() => writeSupportLastSeen(WALLET, 2000)).not.toThrow();
    expect(readSupportLastSeen(WALLET)).toBe(1000);
  });

  it("treats a corrupted stored value as an empty map instead of throwing", () => {
    fakeLocalStorage.setItem("hoodlums.support.lastSeen.v1", "{not json");
    expect(() => readSupportLastSeen(WALLET)).not.toThrow();
    expect(readSupportLastSeen(WALLET)).toBe(0);
  });
});
