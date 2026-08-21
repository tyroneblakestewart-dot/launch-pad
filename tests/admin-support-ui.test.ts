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

  it("renders a ticket's screenshot attachment as an <img>, constrained, with a tap-to-open full-size view (issue #398)", async () => {
    const component = await source("components", "admin-support-section.tsx");
    expect(component).toContain("ticket.attachmentDataUrl");
    expect(component).toContain("setLightboxDataUrl");
    expect(component).toContain("<img");

    const css = await source("components", "admin-support-section.module.css");
    expect(css).toContain(".attachmentThumb");
    expect(css).toMatch(/\.attachmentThumb\s*\{[^}]*max-width:\s*100%/s);
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

  it("hides the reply composer for solved/closed tickets so an owner reply can't implicitly reopen one (issue #393 review)", async () => {
    const component = await source("components", "admin-support-section.tsx");
    expect(component).toContain("isTerminalSupportTicketStatus");
    expect(component).toContain("can no longer be replied to");
  });

  it("only clears the reply draft after the save actually succeeded (issue #393 review)", async () => {
    const component = await source("components", "admin-support-section.tsx");
    expect(component).toContain("Promise<boolean>");
    expect(component).toContain("if (succeeded)");
  });

  it("mirrors the existing admin section CSS module's mobile breakpoint for the 390px iPhone viewport (CLAUDE.md rule 7)", async () => {
    const pagesCss = await source("components", "admin-pages-section.module.css");
    const supportCss = await source("components", "admin-support-section.module.css");
    const breakpoint = pagesCss.match(/@media \(max-width: (\d+)px\)/)?.[1];
    expect(breakpoint).toBeTruthy();
    expect(supportCss).toContain(`@media (max-width: ${breakpoint}px)`);
  });

  it("gives the filter, item-summary and reply/status action controls a real 44px touch target (issue #393 review)", async () => {
    const css = await source("components", "admin-support-section.module.css");
    const minHeightCount = (css.match(/min-height:\s*44px/g) || []).length;
    // refreshButton, filter/filterActive, itemSummary, replyButton/solveButton/closeButton.
    expect(minHeightCount).toBeGreaterThanOrEqual(4);
  });
});
