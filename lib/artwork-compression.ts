export type ArtworkCompressionStep = {
  maxDimension: number;
  quality: number;
};

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
