import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Support unread nav badge (issue #403)", () => {
  it("renders the badge at both nav render points, gated on the shared unread hook", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain('import { useSupportUnread } from "@/lib/use-support-unread";');
    expect(navigation).toContain("const supportUnread = useSupportUnread();");

    // Desktop sidebar utility group.
    expect(navigation).toMatch(
      /UTILITY_NAV_ITEMS\.map\(\(item\) => \{[\s\S]*?item\.href === "\/support" && supportUnread \? <SupportUnreadDot \/> : null/,
    );
    // Mobile pill.
    expect(navigation).toMatch(
      /<NavIcon name=\{item\.icon\} \/>\s*\{item\.href === "\/support" && supportUnread \? <SupportUnreadDot \/> : null\}\s*<\/Link>/,
    );

    const occurrences = (navigation.match(/<SupportUnreadDot \/>/g) || []).length;
    expect(occurrences).toBe(2);
  });

  it("labels the dot for assistive tech without an aria-live surprise", async () => {
    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).toContain('aria-label="Support — new reply waiting"');
    expect(navigation).toContain('role="img"');
  });

  it("never shifts the existing touch-target layout — the dot is absolutely positioned, not laid out inline", async () => {
    const css = await source("components", "app-navigation.module.css");
    expect(css).toMatch(/\.unreadDot\s*\{[^}]*position:\s*absolute/);
    expect(css).toContain("position:relative");
    // The 46px/44px touch targets from issue #396 stay untouched.
    expect(css).toContain("width:46px; height:46px;");
  });

  it("checks for unread on load and window focus only — no polling timer in the nav hook", async () => {
    const hook = await source("lib", "use-support-unread.ts");
    expect(hook).not.toContain("setInterval");
    expect(hook).toContain('window.addEventListener("focus"');
    expect(hook).toContain("void refreshSupportUnread();");
  });

  it("shows no dot (never a false alert) on a failed or rate-limited check, and skips the check entirely with no stored wallet", async () => {
    const hook = await source("lib", "use-support-unread.ts");
    expect(hook).toMatch(/if \(!response\.ok\) \{[\s\S]*?notify\(false\);/);
    expect(hook).toMatch(/catch \{[\s\S]*?notify\(false\);/);
    expect(hook).toMatch(/if \(!wallet\) \{[\s\S]*?notify\(false\);/);
  });

  it("dedupes concurrent nav fetches through a single module-level in-flight promise, so two mounted nav surfaces don't double the request count", async () => {
    const hook = await source("lib", "use-support-unread.ts");
    expect(hook).toContain("let inFlight: Promise<void> | null = null;");
    expect(hook).toContain("if (inFlight) {");
  });
});

describe("Support page live refresh (issue #403)", () => {
  it("refetches on window focus and document visibilitychange", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('document.addEventListener("visibilitychange", handleBecameVisible)');
    expect(component).toContain('window.addEventListener("focus", handleBecameVisible)');
  });

  it("runs a 60s timer only while the tab is visible, and tears it down when hidden", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("60_000");
    expect(component).toMatch(/if \(!isPageVisible\(\)\) \{\s*stopTimer\(\);/);
    // The initial startTimer() gate also goes through the safe visibility
    // helper (issue #405 review) rather than a direct document.visibilityState
    // read, so a hostile/broken environment can't throw here either.
    expect(component).toContain("if (isPageVisible()) startTimer();");
    expect(component).not.toContain('if (document.visibilityState === "visible") startTimer();');
  });

  it("cleans up the timer and both listeners on unmount, guarding every browser-API call against a synchronous throw (issue #405 crash audit)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toMatch(
      /return \(\) => \{\s*stopTimer\(\);\s*safeInvoke\(\(\) => document\.removeEventListener\("visibilitychange", handleBecameVisible\)\);\s*safeInvoke\(\(\) => window\.removeEventListener\("focus", handleBecameVisible\)\);\s*\};/,
    );
  });

  it("is silent — a refresh only ever updates the existing tickets array in place, never resets it to a loading state", async () => {
    const component = await source("components", "support-hub.tsx");
    const loadTicketsBody = component.match(/const loadTickets = useCallback\(async \(wallet: string\) => \{([\s\S]*?)\n {2}\}, \[\]\);/);
    expect(loadTicketsBody).not.toBeNull();
    // setTickets(null) only appears in the separate no-wallet effect, never inside loadTickets itself.
    expect(loadTicketsBody![1]).not.toContain("setTickets(null)");
    expect(component).toContain("setTickets(payload.tickets);");
  });

  it("clears the unread dot by marking last-seen on every successful load, including background refreshes", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('import { markSupportUnreadSeen } from "@/lib/use-support-unread";');
    expect(component).toMatch(/setTicketsError\(null\);\s*\/\/[\s\S]*?markSupportUnreadSeen\(wallet, payload\.tickets\);/);
  });

  it("tells the user plainly what to expect after submitting, so they know they don't need to keep the page open", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("A red dot will appear on the Support tab when there&apos;s");
    expect(component).toContain("you don&apos;t need to keep this page open.");
  });
});

describe("Support read rate limit accounts for the new polling (issue #403)", () => {
  it("raises SUPPORT_READ_LIMIT above the 60s-timer's own 60/hour floor, with the math stated in comments", async () => {
    const protection = await source("lib", "server", "api-protection.ts");
    expect(protection).toContain("export const SUPPORT_READ_LIMIT = 150;");
    expect(protection).toContain("60 reads/hour on its own");
  });
});
