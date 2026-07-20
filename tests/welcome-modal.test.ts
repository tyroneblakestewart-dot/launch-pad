import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOODLUMS_WELCOME_COMPLETE_PARTS } from "@/lib/hoodlums-welcome-sharp-complete-image";

const ROOT = process.cwd();

describe("Hoodlums welcome modal", () => {
  it("assembles all chunks into the complete sharp WebP image", () => {
    const decoded = HOODLUMS_WELCOME_COMPLETE_PARTS.map((part) => Buffer.from(part, "base64"));
    console.log(
      "sharp welcome chunk sizes",
      HOODLUMS_WELCOME_COMPLETE_PARTS.map((part, index) => ({
        index,
        encoded: part.length,
        decoded: decoded[index].length,
      })),
    );
    const image = Buffer.concat(decoded);

    expect(HOODLUMS_WELCOME_COMPLETE_PARTS).toHaveLength(18);
    expect(image.length).toBe(80_732);
    expect(image.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(image.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(image.readUInt32LE(4) + 8).toBe(image.length);
  });

  it("uses the sharp artwork and reduces only the Hoodlums logo", async () => {
    const component = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.tsx"),
      "utf8",
    );
    const css = await readFile(
      path.join(ROOT, "components", "hoodlums-welcome-modal.module.css"),
      "utf8",
    );

    expect(component).toContain("createHoodlumsWelcomeCompleteImageUrl");
    expect(component).toContain("<h1 id=\"hoodlums-welcome-title\">Welcome</h1>");
    expect(component).toContain("<img");
    expect(component).toContain("width={800}");
    expect(component).toContain("height={600}");
    expect(component).toContain("hoodlums.welcome.accepted.v3");
    expect(css).toContain("object-fit: cover;");
    expect(css).toContain("width: min(176px, 42vw);");
    expect(css).toContain("width: 146px;");
    expect(css).toContain(".copy h1 {\n  margin: 0;\n  font-size: clamp(27px, 6vw, 40px);");
  });
});
