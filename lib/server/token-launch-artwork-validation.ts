import { decodeArtworkDataUrl } from "@/lib/server/public-site-artwork";

// Server-side validation for the optional `artworkThumbnail` field on
// POST /api/token-launches (issue #438). Artwork is cosmetic, non-authoritative
// data attached by whoever is already legitimately recording the launch —
// unlike the rest of that request, it is never part of the signed challenge
// payload, so it is validated independently here rather than inside
// lib/server/token-launch-auth.ts. Reuses decodeArtworkDataUrl's existing
// magic-byte sniffing (the declared MIME type must actually match the file
// content, not just claim to) instead of trusting the data URL's own prefix.

/** Decoded-byte ceiling, matching the client capture's own size ceiling
 * (lib/token-artwork-thumbnail.ts) with headroom for a caller that isn't
 * this repo's own client. */
export const MAX_TOKEN_LAUNCH_ARTWORK_THUMBNAIL_BYTES = 160_000;

const ALLOWED_TOKEN_LAUNCH_ARTWORK_MIME_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

export type TokenLaunchArtworkValidation =
  | { valid: true; artworkThumbnail: string | null }
  | { valid: false; reason: string };

/** Absent/null/empty is valid (no artwork). Present but malformed, wrong mime, or oversized is rejected — never stored unvalidated. */
export function validateTokenLaunchArtworkThumbnail(value: unknown): TokenLaunchArtworkValidation {
  if (value === undefined || value === null || value === "") {
    return { valid: true, artworkThumbnail: null };
  }
  if (typeof value !== "string") {
    return { valid: false, reason: "Artwork thumbnail must be a data URL string." };
  }

  const trimmed = value.trim();
  const decoded = decodeArtworkDataUrl(trimmed);
  if (!decoded || !ALLOWED_TOKEN_LAUNCH_ARTWORK_MIME_TYPES.has(decoded.contentType)) {
    return { valid: false, reason: "Artwork thumbnail must be a WEBP, JPEG or PNG data URL." };
  }
  if (decoded.bytes.length > MAX_TOKEN_LAUNCH_ARTWORK_THUMBNAIL_BYTES) {
    return { valid: false, reason: "Artwork thumbnail must be 160 KB or smaller." };
  }

  return { valid: true, artworkThumbnail: trimmed };
}
