import { describe, expect, it } from "vitest";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";

const asDataUrl = (mime: string, bytes: Buffer) =>
  `data:${mime};base64,${bytes.toString("base64")}`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const GIF = Buffer.from("GIF89a", "ascii");
const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii")]);

describe("decodeArtworkDataUrl", () => {
  it.each([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/gif", GIF],
    ["image/webp", WEBP],
  ] as const)("accepts %s only when its magic bytes match", (mime, bytes) => {
    const result = decodeArtworkDataUrl(asDataUrl(mime, bytes));
    expect(result?.contentType).toBe(mime);
    expect(result?.bytes).toEqual(bytes);
  });

  it("rejects a declared MIME type that does not match the bytes", () => {
    expect(decodeArtworkDataUrl(asDataUrl("image/jpeg", PNG))).toBeNull();
    expect(decodeArtworkDataUrl(asDataUrl("image/png", JPEG))).toBeNull();
  });

  it("returns null for missing, malformed, empty or disallowed artwork", () => {
    expect(decodeArtworkDataUrl(undefined)).toBeNull();
    expect(decodeArtworkDataUrl(null)).toBeNull();
    expect(decodeArtworkDataUrl("")).toBeNull();
    expect(decodeArtworkDataUrl("not a data url")).toBeNull();
    expect(decodeArtworkDataUrl("data:image/png;base64,")).toBeNull();
    expect(decodeArtworkDataUrl(asDataUrl("image/svg+xml", PNG))).toBeNull();
  });

  it("rejects artwork above the byte limit", () => {
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(6_000_000),
    ]);
    expect(decodeArtworkDataUrl(asDataUrl("image/png", oversized))).toBeNull();
  });
});
