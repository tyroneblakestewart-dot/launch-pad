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
});
