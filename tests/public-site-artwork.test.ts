import { describe, expect, it } from "vitest";
import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";

const PNG_BASE64 = Buffer.from("fake-png-bytes").toString("base64");

describe("decodeArtworkDataUrl", () => {
  it("decodes a valid PNG data URL", () => {
    const result = decodeArtworkDataUrl(`data:image/png;base64,${PNG_BASE64}`);
    expect(result?.contentType).toBe("image/png");
    expect(result?.bytes.toString()).toBe("fake-png-bytes");
  });

  it("decodes valid jpeg and webp data URLs", () => {
    expect(decodeArtworkDataUrl(`data:image/jpeg;base64,${PNG_BASE64}`)?.contentType).toBe("image/jpeg");
    expect(decodeArtworkDataUrl(`data:image/webp;base64,${PNG_BASE64}`)?.contentType).toBe("image/webp");
  });

  it("returns null for missing artwork", () => {
    expect(decodeArtworkDataUrl(undefined)).toBeNull();
    expect(decodeArtworkDataUrl(null)).toBeNull();
    expect(decodeArtworkDataUrl("")).toBeNull();
  });

  it("returns null for a non-data-URL string", () => {
    expect(decodeArtworkDataUrl("https://example.com/artwork.png")).toBeNull();
    expect(decodeArtworkDataUrl("not a url at all")).toBeNull();
  });

  it("returns null for a disallowed MIME type", () => {
    expect(decodeArtworkDataUrl(`data:image/svg+xml;base64,${PNG_BASE64}`)).toBeNull();
    expect(decodeArtworkDataUrl(`data:text/html;base64,${PNG_BASE64}`)).toBeNull();
    expect(decodeArtworkDataUrl(`data:application/octet-stream;base64,${PNG_BASE64}`)).toBeNull();
  });

  it("returns null for an empty base64 payload", () => {
    expect(decodeArtworkDataUrl("data:image/png;base64,")).toBeNull();
  });
});
