import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTWORK_COMPRESSION_STEPS,
  fitArtworkDimensions,
} from "@/lib/artwork-compression";

describe("artwork compression plan", () => {
  it("keeps shrinking well below the former 900px floor", () => {
    expect(ARTWORK_COMPRESSION_STEPS[0]).toEqual({
      maxDimension: 1800,
      quality: 0.9,
    });
    expect(ARTWORK_COMPRESSION_STEPS.at(-1)).toEqual({
      maxDimension: 315,
      quality: 0.32,
    });

    for (let index = 1; index < ARTWORK_COMPRESSION_STEPS.length; index += 1) {
      expect(ARTWORK_COMPRESSION_STEPS[index].maxDimension).toBeLessThan(
        ARTWORK_COMPRESSION_STEPS[index - 1].maxDimension,
      );
      expect(ARTWORK_COMPRESSION_STEPS[index].quality).toBeLessThan(
        ARTWORK_COMPRESSION_STEPS[index - 1].quality,
      );
    }
  });

  it("preserves aspect ratio while constraining very large artwork", () => {
    expect(fitArtworkDimensions(8000, 6000, 315)).toEqual({
      width: 315,
      height: 236,
    });
    expect(fitArtworkDimensions(1200, 1800, 900)).toEqual({
      width: 600,
      height: 900,
    });
    expect(fitArtworkDimensions(320, 240, 1800)).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("uses JPG after WEBP instead of rejecting detailed images at 900px", () => {
    const source = readFileSync(
      join(process.cwd(), "components/artwork-upload-controller.tsx"),
      "utf8",
    );

    expect(source).toContain('["image/webp", "image/jpeg"] as const');
    expect(source).toContain("ARTWORK_COMPRESSION_STEPS");
    expect(source).toContain("at 3000 px or less");
    expect(source).not.toContain("Math.max(900");
    expect(source).not.toContain("still too detailed to store locally");
  });
});
