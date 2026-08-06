import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("admin Subscribers section UI", () => {
  it("is wired into the admin dashboard as its own section", async () => {
    const dashboard = await source("components/admin-dashboard.tsx");
    expect(dashboard).toContain("AdminSubscribersSection");
    expect(dashboard).toContain('{ id: "subscribers", label: "Subscribers" }');
  });

  it("loads the subscriber listing from the read-only admin endpoint", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain('fetch("/api/admin/subscribers"');
    expect(component).toContain('window.location.replace("/admin")');
    expect(component).not.toContain('"PATCH"');
    expect(component).not.toContain('"POST"');
  });

  it("supports searching, tier filters and lifecycle status filters", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("Search wallet address or slug");
    expect(component).toContain("row.walletAddress.toLowerCase().includes(query)");
    expect(component).toContain("row.slugs.some((slug) => slug.toLowerCase().includes(query))");
    expect(component).toContain("tierFilter");
    expect(component).toContain("statusFilter");
    expect(component).toContain('expiring: "Expiring"');
    expect(component).toContain('pro_bundle: "Pro Bundle"');
  });

  it("sorts by paid_until, soonest first", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("compareByExpiry");
    expect(component).toContain("a.paidUntil");
    expect(component).toContain(".sort(compareByExpiry)");
  });

  it("shows active, expiring and expired counts while retaining expired data", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("expiring within 5 days");
    expect(component).toContain("expired · data retained");
    expect(component).toContain('row.status === "active"');
    expect(component).toContain('row.status === "expiring"');
    expect(component).toContain('row.status === "expired"');
  });

  it("shows paid window, Telegram status and complete payment history", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("Paid from");
    expect(component).toContain("Paid until");
    expect(component).toContain("Telegram reminders");
    expect(component).toContain("Payment history");
    expect(component).toContain("payment.amountDisplay");
    expect(component).toContain("payment.asset");
    expect(component).toContain("payment.billingPeriod");
  });

  it("shows a copy button for the truncated wallet address", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("truncateWallet");
    expect(component).toContain("navigator.clipboard.writeText");
    expect(component).toContain("Copy");
  });

  it("degrades gracefully to 'No subscribers yet' when the list is empty", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("No subscribers yet");
  });
});
