import { describe, expect, it } from "vitest";
import {
  MAX_TOKEN_LAUNCH_ARTWORK_THUMBNAIL_BYTES,
  validateTokenLaunchArtworkThumbnail,
} from "@/lib/server/token-launch-artwork-validation";

const asDataUrl = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString("base64")}`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const GIF = Buffer.from("GIF89a", "ascii");
const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]);

describe("validateTokenLaunchArtworkThumbnail", () => {
  it("treats absent, null or empty as valid with no artwork", () => {
    expect(validateTokenLaunchArtworkThumbnail(undefined)).toEqual({ valid: true, artworkThumbnail: null });
    expect(validateTokenLaunchArtworkThumbnail(null)).toEqual({ valid: true, artworkThumbnail: null });
    expect(validateTokenLaunchArtworkThumbnail("")).toEqual({ valid: true, artworkThumbnail: null });
  });

  it("rejects a non-string value", () => {
    const result = validateTokenLaunchArtworkThumbnail(42);
    expect(result.valid).toBe(false);
  });

  it("accepts a well-formed WEBP, JPEG or PNG data URL under the size ceiling", () => {
    for (const [mime, bytes] of [
      ["image/webp", WEBP],
      ["image/jpeg", JPEG],
      ["image/png", PNG],
    ] as const) {
      const dataUrl = asDataUrl(mime, bytes);
      expect(validateTokenLaunchArtworkThumbnail(dataUrl)).toEqual({ valid: true, artworkThumbnail: dataUrl });
    }
  });

  it("rejects a GIF data URL — outside the allowed webp/jpeg/png set", () => {
    const result = validateTokenLaunchArtworkThumbnail(asDataUrl("image/gif", GIF));
    expect(result.valid).toBe(false);
  });

  it("rejects a declared MIME type whose magic bytes don't match — never trusting the claimed prefix alone", () => {
    const result = validateTokenLaunchArtworkThumbnail(asDataUrl("image/webp", PNG));
    expect(result.valid).toBe(false);
  });

  it("rejects a data URL decoding to more than the 160KB ceiling", () => {
    const oversized = Buffer.concat([WEBP, Buffer.alloc(MAX_TOKEN_LAUNCH_ARTWORK_THUMBNAIL_BYTES)]);
    const result = validateTokenLaunchArtworkThumbnail(asDataUrl("image/webp", oversized));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain("160 KB");
  });

  it("accepts a data URL exactly at the size ceiling", () => {
    const atCeiling = Buffer.concat([
      WEBP,
      Buffer.alloc(MAX_TOKEN_LAUNCH_ARTWORK_THUMBNAIL_BYTES - WEBP.length),
    ]);
    expect(atCeiling.length).toBe(MAX_TOKEN_LAUNCH_ARTWORK_THUMBNAIL_BYTES);
    const result = validateTokenLaunchArtworkThumbnail(asDataUrl("image/webp", atCeiling));
    expect(result.valid).toBe(true);
  });
});
