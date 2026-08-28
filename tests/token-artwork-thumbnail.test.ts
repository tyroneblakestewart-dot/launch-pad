import { describe, expect, it, vi } from "vitest";
import {
  TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS,
  TOKEN_ARTWORK_THUMBNAIL_SIZE_CEILING_BYTES,
  computeSquareCoverCrop,
  computeThumbnailCanvasSize,
  decodedByteLength,
  isWebpDataUrl,
  pickTokenArtworkThumbnail,
} from "@/lib/token-artwork-thumbnail";

function fakeDataUrl(mimeType: "image/webp" | "image/jpeg" | "image/png", byteLength: number): string {
  // 4 base64 chars encode 3 bytes; padding is ignored by decodedByteLength's
  // own `=+$` handling, so an unpadded run of that length is fine here.
  const base64Length = Math.ceil((byteLength * 4) / 3);
  return `data:${mimeType};base64,${"A".repeat(base64Length)}`;
}

describe("computeSquareCoverCrop", () => {
  it("centres a square crop within a wider-than-tall (non-square) source", () => {
    expect(computeSquareCoverCrop(800, 400)).toEqual({ sx: 200, sy: 0, size: 400 });
  });

  it("centres a square crop within a taller-than-wide (non-square) source", () => {
    expect(computeSquareCoverCrop(300, 900)).toEqual({ sx: 0, sy: 300, size: 300 });
  });

  it("is a no-op crop for an already-square source", () => {
    expect(computeSquareCoverCrop(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
  });
});

describe("computeThumbnailCanvasSize", () => {
  it("downscales an oversize crop to the 512 max dimension", () => {
    expect(computeThumbnailCanvasSize(2048)).toBe(512);
  });

  it("never upscales a crop smaller than the max dimension", () => {
    expect(computeThumbnailCanvasSize(300)).toBe(300);
  });

  it("uses exactly 512 at the boundary", () => {
    expect(computeThumbnailCanvasSize(512)).toBe(512);
  });
});

describe("decodedByteLength", () => {
  it("computes the decoded byte length of a base64 payload, ignoring the data URL prefix", () => {
    // "AAAA" -> 3 zero bytes, no padding.
    expect(decodedByteLength("data:image/webp;base64,AAAA")).toBe(3);
  });

  it("accounts for base64 padding", () => {
    // "QQ==" decodes to a single byte ("A").
    expect(decodedByteLength("data:image/webp;base64,QQ==")).toBe(1);
  });

  it("returns 0 for a data URL with no payload", () => {
    expect(decodedByteLength("data:image/webp;base64,")).toBe(0);
  });
});

describe("isWebpDataUrl", () => {
  it("recognises a genuine WEBP data URL", () => {
    expect(isWebpDataUrl("data:image/webp;base64,AAAA")).toBe(true);
  });

  it("rejects a PNG data URL — the silent fallback an unsupported browser returns", () => {
    expect(isWebpDataUrl("data:image/png;base64,AAAA")).toBe(false);
  });
});

describe("pickTokenArtworkThumbnail", () => {
  it("returns the WEBP encode at the first quality step when it already fits", () => {
    const smallWebp = fakeDataUrl("image/webp", 1_000);
    const encode = vi.fn(() => smallWebp);

    const result = pickTokenArtworkThumbnail(encode);

    expect(result).toBe(smallWebp);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS[0], "image/webp");
  });

  it("falls back to JPEG when the encoder can't actually produce WEBP (browsers silently return PNG instead)", () => {
    const unsupportedProbe = fakeDataUrl("image/png", 1_000);
    const smallJpeg = fakeDataUrl("image/jpeg", 1_000);
    const encode = vi.fn((_quality: number, mimeType: "image/webp" | "image/jpeg") =>
      mimeType === "image/webp" ? unsupportedProbe : smallJpeg,
    );

    const result = pickTokenArtworkThumbnail(encode);

    expect(result).toBe(smallJpeg);
    expect(encode).toHaveBeenNthCalledWith(1, TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS[0], "image/webp");
    expect(encode).toHaveBeenNthCalledWith(2, TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS[0], "image/jpeg");
  });

  it("steps quality down up to twice before it fits under the size ceiling", () => {
    const oversized = fakeDataUrl("image/webp", TOKEN_ARTWORK_THUMBNAIL_SIZE_CEILING_BYTES + 1);
    const justRight = fakeDataUrl("image/webp", TOKEN_ARTWORK_THUMBNAIL_SIZE_CEILING_BYTES - 1);
    const encode = vi.fn((quality: number) => (quality === TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS[2] ? justRight : oversized));

    const result = pickTokenArtworkThumbnail(encode);

    expect(result).toBe(justRight);
    expect(encode).toHaveBeenCalledTimes(3);
  });

  it("gives up and returns null when still over the size ceiling after two quality step-downs", () => {
    const alwaysOversized = fakeDataUrl("image/webp", TOKEN_ARTWORK_THUMBNAIL_SIZE_CEILING_BYTES + 1);
    const encode = vi.fn(() => alwaysOversized);

    const result = pickTokenArtworkThumbnail(encode);

    expect(result).toBeNull();
    expect(encode).toHaveBeenCalledTimes(TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS.length);
  });
});
