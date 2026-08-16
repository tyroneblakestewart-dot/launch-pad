import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTWORK_COMPRESSION_STEPS,
  MAX_ARTWORK_SOURCE_BYTES,
  MAX_COMPRESSED_ARTWORK_BYTES,
  TARGET_COMPRESSED_ARTWORK_BYTES,
  estimateDataUrlLength,
  fitArtworkDimensions,
} from "@/lib/artwork-compression";
import { MAX_IMAGE_DATA_URL_LENGTH } from "@/lib/server/generate-site-style";
import { MAX_ARTWORK_REFERENCE_BYTES } from "@/lib/server/published-site-validation";

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

describe("15MB artwork source limit (issue #348)", () => {
  it("accepts source files up to 15MB", () => {
    expect(MAX_ARTWORK_SOURCE_BYTES).toBe(15_000_000);
  });

  it("keeps the compressed-output ceiling well below the source limit and independent of it", () => {
    expect(MAX_COMPRESSED_ARTWORK_BYTES).toBeLessThan(MAX_ARTWORK_SOURCE_BYTES);
    expect(TARGET_COMPRESSED_ARTWORK_BYTES).toBeLessThanOrEqual(MAX_COMPRESSED_ARTWORK_BYTES);
  });

  it("estimates the worst-case base64 data URL length for the compressed-output ceiling", () => {
    // 1,500,000 binary bytes -> ceil(1,500,000/3)*4 base64 chars + "data:image/webp;base64," (23-char) prefix.
    expect(estimateDataUrlLength(MAX_COMPRESSED_ARTWORK_BYTES)).toBe(2_000_023);
  });

  it("a 15MB source's compressed output stays comfortably inside both server-side limits, since compression targets a fixed byte budget regardless of source size", () => {
    const worstCaseDataUrlLength = estimateDataUrlLength(MAX_COMPRESSED_ARTWORK_BYTES);

    expect(worstCaseDataUrlLength).toBeLessThan(MAX_IMAGE_DATA_URL_LENGTH);
    expect(worstCaseDataUrlLength).toBeLessThan(MAX_ARTWORK_REFERENCE_BYTES);

    // Comfortable headroom (at least 50%), not merely "technically fits".
    expect(MAX_IMAGE_DATA_URL_LENGTH).toBeGreaterThanOrEqual(worstCaseDataUrlLength * 1.5);
    expect(MAX_ARTWORK_REFERENCE_BYTES).toBeGreaterThanOrEqual(worstCaseDataUrlLength * 1.5);
  });

  it("wires the client-side source check and controller to the shared 15MB constant instead of a stale 1.5MB/20MB literal", () => {
    const tokenStudio = readFileSync(join(process.cwd(), "components/token-studio.tsx"), "utf8");
    const controller = readFileSync(
      join(process.cwd(), "components/artwork-upload-controller.tsx"),
      "utf8",
    );

    expect(tokenStudio).toContain("MAX_ARTWORK_SOURCE_BYTES");
    expect(tokenStudio).not.toContain("1_500_000");
    expect(tokenStudio).toContain("below 15 MB");

    expect(controller).toContain("MAX_ARTWORK_SOURCE_BYTES");
    expect(controller).toContain("MAX_COMPRESSED_ARTWORK_BYTES");
    expect(controller).toContain("TARGET_COMPRESSED_ARTWORK_BYTES");
    expect(controller).not.toContain("20_000_000");
    expect(controller).toContain("up to 15 MB");
  });
});
