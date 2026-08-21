import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Support hub UI (issue #393)", () => {
  it("is reachable at /support", async () => {
    const page = await source("app", "(app)", "support", "page.tsx");
    expect(page).toContain("SupportHub");
  });

  it("resolves its hero chrome through the Pages CMS registry (CLAUDE.md rule 10)", async () => {
    const page = await source("app", "(app)", "support", "page.tsx");
    expect(page).toContain('resolvePageContent("support"');
    expect(page).toContain("heroEyebrow");
    expect(page).toContain("heroTitle");
    expect(page).toContain("heroIntro");

    const registry = await source("lib", "page-content-registry.ts");
    expect(registry).toContain('id: "support"');
  });

  it("collects category, subject and description", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain("CATEGORY_OPTIONS");
    expect(component).toContain("setSubject");
    expect(component).toContain("setBody");
  });

  it("submits with a wallet-signed support:ticket-create challenge", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('"support:ticket-create"');
    expect(component).toContain("/api/support/challenge");
    expect(component).toContain("/api/support/tickets");
  });

  it("lets a user post a wallet-signed follow-up with support:ticket-reply", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('"support:ticket-reply"');
    expect(component).toContain("/reply");
  });

  it("is reachable from the account overlay without touching the primary launch-flow nav", async () => {
    const overlay = await source("components", "account-overlay.tsx");
    expect(overlay).toContain('href="/support"');
    expect(overlay).toContain("Report a problem");

    const navigation = await source("components", "app-navigation.tsx");
    expect(navigation).not.toContain('href="/support"');
  });

  it("is mobile-first and safe at a 390px iPhone Safari viewport (CLAUDE.md rule 7)", async () => {
    const css = await source("components", "support-hub.module.css");
    expect(css).toContain("@media (max-width: 390px)");
    expect(css).toContain("min-width: 0");
    expect(css).not.toMatch(/width:\s*\d{4,}px/);
  });

  it("reacts to an accountsChanged event so ticket history follows the active wallet (issue #393 review)", async () => {
    const component = await source("components", "support-hub.tsx");
    expect(component).toContain('provider.on?.("accountsChanged"');
    expect(component).toContain('provider.removeListener?.("accountsChanged"');
    expect(component).toContain("setWalletAddress(nextAccount || null)");
  });

  it("gives every actionable control a real 44px touch target (issue #393 review)", async () => {
    const css = await source("components", "support-hub.module.css");
    const minHeightCount = (css.match(/min-height:\s*44px/g) || []).length;
    // connectButton/submitButton, select/input/textarea, ticketSummary, replyButton.
    expect(minHeightCount).toBeGreaterThanOrEqual(4);

    const overlayCss = await source("components", "account-overlay.module.css");
    expect(overlayCss).toContain(".supportLink");
    expect(overlayCss).toMatch(/\.supportLink\s*\{[^}]*min-height:\s*44px/s);
  });
});
