/**
 * Decodes and validates artwork stored on a public generated-site record.
 * The declared MIME type and the file magic bytes must agree.
 */

const ALLOWED_ARTWORK_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DATA_URL_PATTERN = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/i;
const MAX_ARTWORK_BYTES = 6_000_000;

export type DecodedArtwork = {
  contentType: string;
  bytes: Buffer;
};

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function hasMatchingMagicBytes(contentType: string, bytes: Buffer): boolean {
  if (contentType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (contentType === "image/gif") {
    const header = bytes.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (contentType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

export function decodeArtworkDataUrl(dataUrl: string | null | undefined): DecodedArtwork | null {
  if (typeof dataUrl !== "string" || !dataUrl) return null;

  const match = DATA_URL_PATTERN.exec(dataUrl.trim());
  if (!match) return null;

  const [, mimeType, base64] = match;
  const contentType = mimeType.toLowerCase();
  if (!ALLOWED_ARTWORK_MIME_TYPES.has(contentType)) return null;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return null;
  }

  if (bytes.length === 0 || bytes.length > MAX_ARTWORK_BYTES) return null;
  if (!hasMatchingMagicBytes(contentType, bytes)) return null;
  return { contentType, bytes };
}
