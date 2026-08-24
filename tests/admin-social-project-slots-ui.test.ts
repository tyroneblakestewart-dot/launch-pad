import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("admin Project Slots section UI (issue #407)", () => {
  it("is wired into the admin dashboard as its own section", async () => {
    const dashboard = await source("components/admin-dashboard.tsx");
    expect(dashboard).toContain("AdminSocialProjectSlotsSection");
    expect(dashboard).toContain('{ id: "social-project-slots", label: "Project Slots" }');
  });

  it("loads slot data from the read-only subscribers endpoint and releases via the dedicated admin action route", async () => {
    const component = await source("components/admin-social-project-slots-section.tsx");
    expect(component).toContain('fetch("/api/admin/subscribers"');
    expect(component).toContain('fetch("/api/admin/social-project-slots/actions"');
    expect(component).toContain('method: "POST"');
    expect(component).toContain('action: "release"');
  });

  it("requires a two-tap confirmation before releasing, naming the cooldown bypass", async () => {
    const component = await source("components/admin-social-project-slots-section.tsx");
    expect(component).toContain("pendingReleaseKey");
    expect(component).toContain("Confirm release");
    expect(component).toContain("Cancel");
    expect(component).toContain("bypasses the wallet");
  });

  it("redirects to /admin on an expired session", async () => {
    const component = await source("components/admin-social-project-slots-section.tsx");
    expect(component).toContain('window.location.replace("/admin")');
  });

  it("has 44px-minimum touch targets for the release/confirm/cancel actions (source-checked, not device-verified)", async () => {
    const css = await source("components/admin-social-project-slots-section.module.css");
    expect(css).toMatch(/\.releaseButton\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.confirmButton,\s*\.cancelButton\s*\{[^}]*min-height:\s*44px/);
  });
});
