import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Admin Accounts UI", () => {
  it("is wired into the existing authenticated admin dashboard", async () => {
    const dashboard = await source("components", "admin-dashboard.tsx");
    expect(dashboard).toContain('import { AdminAccountsSection }');
    expect(dashboard).toContain('{ id: "accounts", label: "Accounts" }');
    expect(dashboard).toContain('<AdminAccountsSection />');
  });

  it("supports wallet or Telegram search and every requested record section", async () => {
    const accounts = await source("components", "admin-accounts-section.tsx");
    expect(accounts).toContain("Wallet address or Telegram username");
    expect(accounts).toContain("0x… or @username");
    expect(accounts).toContain("Timeline");
    expect(accounts).toContain("Payments");
    expect(accounts).toContain("Lifecycle & reminders");
    expect(accounts).toContain("Tokens launched");
    expect(accounts).toContain("Sites published");
    expect(accounts).toContain("Hoodchat");
    expect(accounts).toContain("Reports");
    expect(accounts).toContain("transactionHash");
  });

  it("loads details on demand and paginates instead of fetching an unbounded history", async () => {
    const accounts = await source("components", "admin-accounts-section.tsx");
    expect(accounts).toContain('pageSize: "20"');
    expect(accounts).toContain("Previous");
    expect(accounts).toContain("Next");
    expect(accounts).toContain("selectSection(activeSection, sectionResponse.page + 1)");
    expect(accounts).toContain('cache: "no-store"');
  });
});
