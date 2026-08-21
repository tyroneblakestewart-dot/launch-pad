import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(...parts: string[]): Promise<string> {
  return readFile(path.join(ROOT, ...parts), "utf8");
}

describe("Admin Support UI", () => {
  it("is wired into the existing authenticated admin dashboard as an independent section", async () => {
    const dashboard = await source("components", "admin-dashboard.tsx");
    expect(dashboard).toContain('import { AdminSupportSection }');
    expect(dashboard).toContain('{ id: "support", label: "Support" }');
    expect(dashboard).toContain('<AdminSupportSection />');
    expect(dashboard).toContain('activeSection === "support"');
  });

  it("filters by Open / Needs user / Solved / Closed / All status", async () => {
    const component = await source("components", "admin-support-section.tsx");
    expect(component).toContain('{ id: "open", label: "Open" }');
    expect(component).toContain('{ id: "needs_user", label: "Needs user" }');
    expect(component).toContain('{ id: "solved", label: "Solved" }');
    expect(component).toContain('{ id: "closed", label: "Closed" }');
    expect(component).toContain('{ id: "all", label: "All" }');
  });

  it("shows full diagnostics and the full message history", async () => {
    const component = await source("components", "admin-support-section.tsx");
    expect(component).toContain("ticket.diagnostics");
    expect(component).toContain("ticket.messages");
  });

  it("provides an owner reply box that creates an owner message", async () => {
    const component = await source("components", "admin-support-section.tsx");
    expect(component).toContain('action: "reply"');
    expect(component).toContain("Send reply");
  });

  it("provides status controls for solved and closed", async () => {
    const component = await source("components", "admin-support-section.tsx");
    expect(component).toContain('status: "solved"');
    expect(component).toContain('status: "closed"');
    expect(component).toContain("Mark solved");
    expect(component).toContain("Close");
  });

  it("mirrors the existing admin section CSS module's mobile breakpoint for the 390px iPhone viewport (CLAUDE.md rule 7)", async () => {
    const pagesCss = await source("components", "admin-pages-section.module.css");
    const supportCss = await source("components", "admin-support-section.module.css");
    const breakpoint = pagesCss.match(/@media \(max-width: (\d+)px\)/)?.[1];
    expect(breakpoint).toBeTruthy();
    expect(supportCss).toContain(`@media (max-width: ${breakpoint}px)`);
  });
});
