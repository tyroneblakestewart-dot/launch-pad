import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("admin Street Team section UI", () => {
  it("is wired into the admin dashboard as its own section", async () => {
    const dashboard = await source("components/admin-dashboard.tsx");
    expect(dashboard).toContain("AdminStreetTeamSection");
    expect(dashboard).toContain('{ id: "street-team", label: "Street Team" }');
    expect(dashboard).toContain('activeSection === "street-team"');
  });

  it("loads the interest listing from the read-only admin endpoint", async () => {
    const component = await source("components/admin-street-team-section.tsx");
    expect(component).toContain('fetch("/api/admin/street-team"');
    expect(component).toContain('window.location.replace("/admin")');
    expect(component).not.toContain('"PATCH"');
    expect(component).not.toContain('"POST"');
  });

  it("shows a total count plus recent entries with each entry's current plan", async () => {
    const component = await source("components/admin-street-team-section.tsx");
    expect(component).toContain("total interest signups");
    expect(component).toContain("snapshot?.count");
    expect(component).toContain("snapshot?.recent");
    expect(component).toContain("PLAN_LABEL[entry.currentPlan]");
    expect(component).toContain("Anonymous");
  });
});
