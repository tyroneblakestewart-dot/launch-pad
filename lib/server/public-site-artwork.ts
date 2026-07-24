/**
 * Decodes and validates the data-URL artwork stored on a public generated
 * site record so it can be served over HTTP (for the public page and the
 * OG/artwork image route) instead of ever placing a `data:` URL directly
 * in page metadata.
 */

const ALLOWED_ARTWORK_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DATA_URL_PATTERN = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/i;
const MAX_ARTWORK_BYTES = 6_000_000;

export type DecodedArtwork = {
  contentType: string;
  bytes: Buffer;
};

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
  return { contentType, bytes };
}
