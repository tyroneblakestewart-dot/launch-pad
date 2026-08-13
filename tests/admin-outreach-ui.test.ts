import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Admin Outreach UI", () => {
  it("is wired into the existing authenticated admin dashboard as an independent section", async () => {
    const dashboard = await source("components", "admin-dashboard.tsx");
    expect(dashboard).toContain('import { AdminOutreachSection }');
    expect(dashboard).toContain('{ id: "outreach", label: "Outreach" }');
    expect(dashboard).toContain('<AdminOutreachSection />');
    expect(dashboard).toContain('activeSection === "outreach"');
  });

  it("shows the exact dormant notice text when posting is not configured", async () => {
    const component = await source("components", "admin-outreach-section.tsx");
    expect(component).toContain("posting not configured — outreach is dormant");
    expect(component).toContain("!postingConfigured");
  });

  it("disables the Approve button (not just hides it) when posting is not configured — defense in depth lives in the route", async () => {
    const component = await source("components", "admin-outreach-section.tsx");
    expect(component).toMatch(/disabled=\{busy \|\| !postingConfigured\}/);
  });

  it("shows Approve/Edit/Dismiss for pending drafts, and the failure reason on failed items", async () => {
    const component = await source("components", "admin-outreach-section.tsx");
    expect(component).toContain("Approve");
    expect(component).toContain("Edit");
    expect(component).toContain("Dismiss");
    expect(component).toContain("item.errorMessage");
    expect(component).toContain("Failed:");
  });

  it("shows token art, ticker, name and progress on each draft card", async () => {
    const component = await source("components", "admin-outreach-section.tsx");
    expect(component).toContain("item.tokenArtworkUrl");
    expect(component).toContain("item.tokenTicker");
    expect(component).toContain("item.tokenName");
    expect(component).toContain("item.progressPercent");
  });

  it("shows which creator handle would be @-mentioned, when present", async () => {
    const component = await source("components", "admin-outreach-section.tsx");
    expect(component).toContain("item.creatorXHandle");
  });

  it("filters by Pending / Posted / Failed / Dismissed status", async () => {
    const component = await source("components", "admin-outreach-section.tsx");
    expect(component).toContain('{ id: "pending", label: "Pending" }');
    expect(component).toContain('{ id: "posted", label: "Posted" }');
    expect(component).toContain('{ id: "failed", label: "Failed" }');
    expect(component).toContain('{ id: "dismissed", label: "Dismissed" }');
  });

  it("mirrors the existing admin section CSS module's mobile breakpoint for the 390px iPhone viewport (CLAUDE.md rule 7)", async () => {
    const pagesCss = await source("components", "admin-pages-section.module.css");
    const outreachCss = await source("components", "admin-outreach-section.module.css");
    const breakpoint = pagesCss.match(/@media \(max-width: (\d+)px\)/)?.[1];
    expect(breakpoint).toBeTruthy();
    expect(outreachCss).toContain(`@media (max-width: ${breakpoint}px)`);
  });
});
