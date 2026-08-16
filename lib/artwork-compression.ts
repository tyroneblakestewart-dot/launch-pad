export type ArtworkCompressionStep = {
  maxDimension: number;
  quality: number;
};

// Shared source of truth for artwork upload sizing (issue #348). Raising the
// accepted *source* file to 15MB does not change what actually gets stored
// or sent to the AI: MAX_COMPRESSED_ARTWORK_BYTES is a fixed output ceiling
// the client-side compressor (components/artwork-upload-controller.tsx)
// already targets regardless of how large the original photo is — a bigger
// source just needs more/smaller compression steps to land under the same
// ceiling. Server-side limits (lib/server/generate-site-style.ts,
// lib/server/published-site-validation.ts) are sized off that ceiling via
// estimateDataUrlLength below, not by scaling with the source limit.
export const MAX_ARTWORK_SOURCE_BYTES = 15_000_000;
export const MAX_COMPRESSED_ARTWORK_BYTES = 1_500_000;
export const TARGET_COMPRESSED_ARTWORK_BYTES = 1_250_000;

/** Worst-case base64 data: URL length for a given binary payload size, used to size server-side data-URL limits off the real compression ceiling instead of guessing. */
export function estimateDataUrlLength(binaryBytes: number, mimeType: string = "image/webp"): number {
  return `data:${mimeType};base64,`.length + Math.ceil(binaryBytes / 3) * 4;
}

export const ARTWORK_COMPRESSION_STEPS: readonly ArtworkCompressionStep[] = [
  { maxDimension: 1800, quality: 0.9 },
  { maxDimension: 1512, quality: 0.84 },
  { maxDimension: 1270, quality: 0.78 },
  { maxDimension: 1067, quality: 0.72 },
  { maxDimension: 896, quality: 0.66 },
  { maxDimension: 753, quality: 0.6 },
  { maxDimension: 633, quality: 0.54 },
  { maxDimension: 532, quality: 0.48 },
  { maxDimension: 447, quality: 0.42 },
  { maxDimension: 375, quality: 0.36 },
  { maxDimension: 315, quality: 0.32 },
] as const;

export function fitArtworkDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  const limit = Math.max(1, Math.round(maxDimension));
  const scale = Math.min(1, limit / width, limit / height);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
