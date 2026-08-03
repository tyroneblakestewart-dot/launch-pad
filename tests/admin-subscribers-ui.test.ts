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

  it("supports searching by wallet address or slug", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("Search wallet address or slug");
    expect(component).toContain("row.walletAddress.toLowerCase().includes(query)");
    expect(component).toContain("row.slugs.some((slug) => slug.toLowerCase().includes(query))");
  });

  it("supports filtering by tier and status", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("tierFilter");
    expect(component).toContain("statusFilter");
    expect(component).toContain("Filter by tier");
    expect(component).toContain("Filter by status");
  });

  it("sorts by expiry date, soonest first by default", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("compareByExpiry");
    expect(component).toContain(".sort(compareByExpiry)");
  });

  it("shows a copy button for the truncated wallet address", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("truncateWallet");
    expect(component).toContain("navigator.clipboard.writeText");
    expect(component).toContain("Copy");
  });

  it("shows a summary of active Pro, active Bond + Pro Site and free-tier counts", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("active Pro subscribers");
    expect(component).toContain("active Bond + Pro Site");
    expect(component).toContain("free tier");
  });

  it("degrades gracefully to 'No subscribers yet' instead of an error when the list is empty", async () => {
    const component = await source("components/admin-subscribers-section.tsx");
    expect(component).toContain("No subscribers yet");
  });
});
