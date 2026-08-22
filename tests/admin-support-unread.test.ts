import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasAdminSupportNews,
  readAdminSupportLastSeen,
  writeAdminSupportLastSeen,
} from "@/lib/admin-support-unread";
import { createFakeLocalStorage, type FakeLocalStorage } from "./fake-local-storage-test-helper";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("hasAdminSupportNews (issue #405)", () => {
  it("flags a brand-new ticket created after last-seen", () => {
    const tickets = [{ createdAt: "2026-08-22T10:00:00.000Z", messages: [] }];
    expect(hasAdminSupportNews(tickets, Date.parse("2026-08-22T09:00:00.000Z"))).toBe(true);
  });

  it("flags a user follow-up message posted after last-seen", () => {
    const tickets = [
      {
        createdAt: "2026-08-20T00:00:00.000Z",
        messages: [{ author: "user" as const, createdAt: "2026-08-22T10:00:00.000Z" }],
      },
    ];
    expect(hasAdminSupportNews(tickets, Date.parse("2026-08-22T09:00:00.000Z"))).toBe(true);
  });

  it("does NOT flag an owner-authored message — the owner already knows about their own reply", () => {
    const tickets = [
      {
        createdAt: "2026-08-20T00:00:00.000Z",
        messages: [{ author: "owner" as const, createdAt: "2026-08-22T10:00:00.000Z" }],
      },
    ];
    expect(hasAdminSupportNews(tickets, Date.parse("2026-08-22T09:00:00.000Z"))).toBe(false);
  });

  it("does not flag an old ticket with only old messages", () => {
    const tickets = [
      {
        createdAt: "2026-08-01T00:00:00.000Z",
        messages: [{ author: "user" as const, createdAt: "2026-08-01T00:05:00.000Z" }],
      },
    ];
    expect(hasAdminSupportNews(tickets, Date.parse("2026-08-22T09:00:00.000Z"))).toBe(false);
  });

  it("treats never-seen (last-seen 0) as news for any current ticket", () => {
    const tickets = [{ createdAt: "2020-01-01T00:00:00.000Z", messages: [] }];
    expect(hasAdminSupportNews(tickets, 0)).toBe(true);
  });

  it("ignores a malformed createdAt instead of throwing", () => {
    const tickets = [{ createdAt: "not-a-date", messages: [{ author: "user" as const, createdAt: "also-not-a-date" }] }];
    expect(() => hasAdminSupportNews(tickets, 0)).not.toThrow();
    expect(hasAdminSupportNews(tickets, 0)).toBe(false);
  });
});

describe("admin support last-seen storage (issue #405)", () => {
  let fakeLocalStorage: FakeLocalStorage;

  beforeEach(() => {
    fakeLocalStorage = createFakeLocalStorage();
    vi.stubGlobal("localStorage", fakeLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 0 when nothing has ever been recorded", () => {
    expect(readAdminSupportLastSeen()).toBe(0);
  });

  it("round-trips a written timestamp", () => {
    writeAdminSupportLastSeen(1_700_000_000_000);
    expect(readAdminSupportLastSeen()).toBe(1_700_000_000_000);
  });

  it("never throws when storage.setItem fails (Safari privacy/security/quota exceptions), and leaves the previous value alone", () => {
    writeAdminSupportLastSeen(1000);
    fakeLocalStorage.failNextSetItemWith = new Error("quota exceeded");
    expect(() => writeAdminSupportLastSeen(2000)).not.toThrow();
    expect(readAdminSupportLastSeen()).toBe(1000);
  });

  it("treats a corrupted stored value as never-seen instead of throwing", () => {
    fakeLocalStorage.setItem("hoodlums.admin.support.lastSeen.v1", "not-a-number");
    expect(() => readAdminSupportLastSeen()).not.toThrow();
    expect(readAdminSupportLastSeen()).toBe(0);
  });
});

describe("/admin Support nav dot wiring (issue #405)", () => {
  it("checks on initial load and window focus only — no new polling timer", async () => {
    const hook = await source("lib", "use-admin-support-unread.ts");
    expect(hook).not.toContain("setInterval");
    expect(hook).toContain('window.addEventListener("focus"');
    expect(hook).toContain("void refreshAdminSupportUnread();");
  });

  it("shows no dot on a failed or unauthenticated check", async () => {
    const hook = await source("lib", "use-admin-support-unread.ts");
    expect(hook).toMatch(/if \(!response\.ok\) \{[\s\S]*?notify\(false\);/);
    expect(hook).toMatch(/catch \{[\s\S]*?notify\(false\);/);
  });

  it("dedupes concurrent fetches through a single module-level in-flight promise", async () => {
    const hook = await source("lib", "use-admin-support-unread.ts");
    expect(hook).toContain("let inFlight: Promise<void> | null = null;");
    expect(hook).toContain("if (inFlight) {");
  });

  it("is wired into the dashboard nav button for the support section only", async () => {
    const dashboard = await source("components", "admin-dashboard.tsx");
    expect(dashboard).toContain('import { useAdminSupportUnread } from "@/lib/use-admin-support-unread";');
    expect(dashboard).toContain("const supportUnread = useAdminSupportUnread();");
    expect(dashboard).toMatch(/section\.id === "support" && supportUnread \? \(/);

    const css = await source("components", "admin-dashboard.module.css");
    expect(css).toContain(".navUnreadDot");
    expect(css).toMatch(/\.navUnreadDot\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(/\.navItem,\s*\.navItemActive\s*\{\s*position:\s*relative;/);
  });

  it("clears the dot once the Support section's own listing has loaded, not just on the very first load", async () => {
    const section = await source("components", "admin-support-section.tsx");
    expect(section).toContain('import { markAdminSupportSeen } from "@/lib/use-admin-support-unread";');
    expect(section).toMatch(/setLoadError\(null\);\s*\/\/[\s\S]*?markAdminSupportSeen\(\);/);
  });
});
