import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOODLUMS_WELCOME_COMPLETE_IMAGE,
  HOODLUMS_WELCOME_COMPLETE_PARTS,
} from "@/lib/hoodlums-welcome-sharp-complete-image";

const ROOT = process.cwd();

describe("Hoodlums welcome modal", () => {
  it("assembles all chunks into the complete sharp WebP image", () => {
    const image = Buffer.concat(
      HOODLUMS_WELCOME_COMPLETE_PARTS.map((part) => Buffer.from(part, "base64")),
    );

    expect(HOODLUMS_WELCOME_COMPLETE_PARTS).toHaveLength(18);
    expect(HOODLUMS_WELCOME_COMPLETE_IMAGE.startsWith("data:image/webp;base64,")).toBe(true);
    expect(image.length).toBe(80_732);
    expect(image.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(image.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(image.readUInt32LE(4) + 8).toBe(image.length);
  });

  it("uses the sharp artwork and keeps the reduced Hoodlums logo", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.tsx"),
      "utf8",
    );
    const css = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.module.css"),
      "utf8",
    );

    expect(component).toContain("HOODLUMS_WELCOME_COMPLETE_IMAGE");
    expect(component).toContain("<h1 id=\"hoodlums-welcome-title\">Welcome</h1>");
    expect(component).toContain("width={800}");
    expect(component).toContain("height={600}");
    expect(component).toContain("hoodlums.welcome.accepted.v4");
    expect(css).toContain("object-fit: cover;");
    expect(css).toContain("width: min(176px, 42vw);");
    expect(css).toContain("width: 146px;");
  });

  it("provides eight hover, touch, and keyboard character hotspots with one active label", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.tsx"),
      "utf8",
    );
    const css = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.module.css"),
      "utf8",
    );

    for (const expected of [
      'id: "mari"',
      'id: "uncle-tuck"',
      'id: "big-jon"',
      'id: "robbin"',
      'id: "pj"',
      'id: "lord-greene"',
      'id: "the-sheriff"',
      'id: "the-aristocrat"',
    ]) {
      expect(component).toContain(expected);
    }

    expect(component.match(/data-crew-hotspot/g)).toHaveLength(2);
    expect(component).toContain("activeCrew === character.id");
    expect(component).toContain('event.pointerType === "mouse"');
    expect(component).toContain('if (event.pointerType === "mouse") return;');
    expect(component).toContain("onPointerEnter");
    expect(component).toContain("onPointerLeave");
    expect(component).toContain("onPointerDown");
    expect(component).toContain("onFocus");
    expect(component).toContain("onBlur");
    expect(component).toContain("setActiveCrew(null)");
    expect(component).toContain("aria-expanded={active}");
    expect(css).toContain(".crewHotspot");
    expect(css).toContain(".crewLabelVisible");
    expect(css).toContain("pointer-events: none;");
    expect(css).toContain("transition: opacity 180ms ease, transform 180ms ease;");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
