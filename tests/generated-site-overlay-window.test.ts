import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function generatorSource() {
  return readFile(path.join(ROOT, "components", "full-website-generator.tsx"), "utf8");
}

// Issue #318: "Once a site is generated (or reopened from a saved launch),
// present it in ONE branded overlay window on top of the studio" — the
// overlay must be a fixed window with a backdrop from the moment it opens
// (not only once "Full screen" is pressed), and it must stay a single
// mounted iframe with its backdrop cleaned up on close, same as the rest of
// CLAUDE.md rule 7's one-live-iframe invariant.
describe("the generated-site overlay is a fixed window with a backdrop (issue #318)", () => {
  it("creates exactly one backdrop element alongside the one iframe", async () => {
    const source = await generatorSource();

    expect((source.match(/document\.createElement\("iframe"\)/g) || []).length).toBe(1);
    expect((source.match(/const backdrop = document\.createElement\("div"\);/g) || []).length).toBe(1);
    expect(source).toContain('backdrop.className = "full-generated-page-backdrop";');
  });

  it("mounts the backdrop and container together, and removes both on disposal", async () => {
    const source = await generatorSource();

    expect(source).toContain('site.append(backdrop, container);');
    expect(source).toContain("preview.container.remove();");
    expect(source).toContain("preview.backdrop.remove();");
    expect(source.indexOf("preview.container.remove();")).toBeLessThan(
      source.indexOf("preview.backdrop.remove();"),
    );
  });

  it("positions the default (non-fullscreen) container as a fixed, centred window — not embedded inline in the page", async () => {
    const source = await generatorSource();

    const containerRuleStart = source.indexOf(".full-generated-page-container {");
    const containerRuleEnd = source.indexOf("}", containerRuleStart);
    const containerRule = source.slice(containerRuleStart, containerRuleEnd);

    expect(containerRule).toContain("position: fixed;");
    expect(containerRule).toContain("margin: auto;");

    const backdropRuleStart = source.indexOf(".full-generated-page-backdrop {");
    const backdropRuleEnd = source.indexOf("}", backdropRuleStart);
    const backdropRule = source.slice(backdropRuleStart, backdropRuleEnd);
    expect(backdropRule).toContain("position: fixed;");
    expect(backdropRule).toContain("inset: 0;");
  });

  it("keeps the fullscreen toggle overriding the same container to edge-to-edge", async () => {
    const source = await generatorSource();

    expect(source).toContain(".full-generated-page-container.full-generated-page-fullscreen {");
    expect(source).toContain("width: 100vw;");
    expect(source).toContain("height: 100svh;");
  });
});
