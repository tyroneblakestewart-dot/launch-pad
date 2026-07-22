import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

async function source(file: string) {
  return readFile(path.join(ROOT, file), "utf8");
}

describe("Hoodlums welcome artwork", () => {
  it("keeps all eight touch targets and reveals names on touch", async () => {
    const component = await source("components/hoodlums-welcome-modal.tsx");

    for (const id of [
      "mari",
      "uncle-tuck",
      "big-jon",
      "robbin",
      "pj",
      "lord-greene",
      "the-sheriff",
      "the-aristocrat",
    ]) {
      expect(component).toContain(`id: "${id}"`);
    }

    expect(component).toContain("Tap a character to reveal their name");
    expect(component).toContain("handlePointerDown");
    expect(component).toContain("styles.crewHotspotActive");
    expect(component).toContain("styles.crewLabelVisible");
  });

  it("lifts the artwork brightness without removing the dark presentation", async () => {
    const css = await source("components/hoodlums-welcome-modal.module.css");

    expect(css).toContain("brightness(1.22)");
    expect(css).toContain("contrast(1.06)");
    expect(css).toContain("saturate(1.08)");
    expect(css).toContain(".crewHotspotActive");
    expect(css).toContain("@media (hover: none), (pointer: coarse)");
  });
});
