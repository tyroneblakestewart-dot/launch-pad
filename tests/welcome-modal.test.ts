import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOODLUMS_WELCOME_SHARP_IMAGE } from "@/lib/hoodlums-welcome-sharp-image";

const ROOT = process.cwd();

describe("Hoodlums welcome modal", () => {
  it("assembles a complete WebP image instead of a broken or partial payload", () => {
    expect(HOODLUMS_WELCOME_SHARP_IMAGE.startsWith("data:image/webp;base64,")).toBe(true);

    const encoded = HOODLUMS_WELCOME_SHARP_IMAGE.split(",", 2)[1];
    const image = Buffer.from(encoded, "base64");

    expect(image.length).toBeGreaterThan(120_000);
    expect(image.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(image.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(image.readUInt32LE(4) + 8).toBe(image.length);
  });

  it("uses the sharp image directly and keeps the Welcome heading while reducing only the logo", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.tsx"),
      "utf8",
    );
    const css = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.module.css"),
      "utf8",
    );

    expect(component).toContain("HOODLUMS_WELCOME_SHARP_IMAGE");
    expect(component).toContain("<h1 id=\"hoodlums-welcome-title\">Welcome</h1>");
    expect(component).toContain("<img");
    expect(component).toContain("hoodlums.welcome.accepted.v3");
    expect(css).toContain("object-fit: cover;");
    expect(css).toContain("width: min(176px, 42vw);");
    expect(css).toContain("width: 146px;");
    expect(css).toContain(".copy h1 {\n  margin: 0;\n  font-size: clamp(27px, 6vw, 40px);");
  });
});
