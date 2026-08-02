import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string): Promise<string> {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("admin Pages CMS section UI", () => {
  it("is wired into the admin dashboard as its own section", async () => {
    const dashboard = await source("components/admin-dashboard.tsx");
    expect(dashboard).toContain("AdminPagesSection");
    expect(dashboard).toContain('{ id: "pages", label: "Pages" }');
  });

  it("loads the page listing from the read-only admin endpoint", async () => {
    const component = await source("components/admin-pages-section.tsx");
    expect(component).toContain('fetch("/api/admin/pages"');
    expect(component).toContain('window.location.replace("/admin")');
  });

  it("stages edits as a draft via PATCH before anything can be published", async () => {
    const component = await source("components/admin-pages-section.tsx");
    expect(component).toContain('method: "PATCH"');
    expect(component).toContain("Save draft");
  });

  it("exposes publish, publish-all, discard and reset-to-default actions", async () => {
    const component = await source("components/admin-pages-section.tsx");
    expect(component).toContain('"/api/admin/pages/actions"');
    expect(component).toContain('runAction(page.id, element.id, "publish")');
    expect(component).toContain('runAction(page.id, undefined, "publish-all")');
    expect(component).toContain('runAction(page.id, element.id, "discard")');
    expect(component).toContain('runAction(page.id, element.id, "reset")');
  });

  it("links to a real preview of the public page with the CMS preview query param", async () => {
    const component = await source("components/admin-pages-section.tsx");
    expect(component).toContain("cms_preview=1");
    expect(component).toContain("page.route");
  });

  it("visibly marks edited-but-unpublished elements as drafts", async () => {
    const component = await source("components/admin-pages-section.tsx");
    expect(component).toContain("Draft, unpublished");
    expect(component).toContain("styles.badgeDraft");
  });
});
