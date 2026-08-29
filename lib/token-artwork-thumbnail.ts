/**
 * Client-side capture of a small token-launch artwork thumbnail (issue
 * #438). token_launches stores no artwork reference at all today, so every
 * homepage grid card falls back to a letter initial even when the studio
 * project already has a `heroImage` data URL in memory at launch time. This
 * module downscales that hero image to a square cover-crop, at most
 * TOKEN_ARTWORK_THUMBNAIL_MAX_DIMENSION per side, encoded WEBP (falling back
 * to JPEG on a browser that can't encode WEBP), stepping quality down up to
 * twice if the result is still over TOKEN_ARTWORK_THUMBNAIL_SIZE_CEILING_BYTES
 * — and gives up (returns null) rather than ever send something oversized.
 * CLAUDE.md's PR #118 iPhone Safari memory rule applies directly: the full-size
 * artwork is read once from an already-in-memory project, downscaled, and
 * discarded — never written to React state or threaded through props.
 *
 * The pure pieces below (crop geometry, byte-length maths, mime-type
 * detection, quality-stepping/fallback selection) are unit tested directly.
 * `captureTokenArtworkThumbnail` composes them with real canvas/Image calls
 * and is not itself unit tested, following the existing split between
 * lib/artwork-compression.ts (tested) and
 * components/artwork-upload-controller.tsx (untested DOM driver).
 */

export const TOKEN_ARTWORK_THUMBNAIL_MAX_DIMENSION = 512;
export const TOKEN_ARTWORK_THUMBNAIL_SIZE_CEILING_BYTES = 120_000;
/** Initial quality, then up to two step-downs — three attempts total before giving up. */
export const TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS = [0.8, 0.6, 0.4] as const;

export type TokenArtworkThumbnailMimeType = "image/webp" | "image/jpeg";

/** Centre square-crop rectangle, in source-image pixel space, for a cover-crop to a 1:1 aspect ratio. */
export function computeSquareCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
): { sx: number; sy: number; size: number } {
  const size = Math.max(1, Math.round(Math.min(sourceWidth, sourceHeight)));
  const sx = Math.max(0, Math.round((sourceWidth - size) / 2));
  const sy = Math.max(0, Math.round((sourceHeight - size) / 2));
  return { sx, sy, size };
}

/** Never upscales a smaller source past its own crop size — only ever shrinks toward the max dimension. */
export function computeThumbnailCanvasSize(cropSize: number): number {
  return Math.max(1, Math.min(Math.round(cropSize), TOKEN_ARTWORK_THUMBNAIL_MAX_DIMENSION));
}

/** Decoded byte length of a base64 data URL's payload, ignoring the `data:...;base64,` prefix. */
export function decodedByteLength(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex === -1 ? "" : dataUrl.slice(commaIndex + 1);
  if (!base64) return 0;
  const paddingMatch = /=+$/.exec(base64);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** True only when the data URL is genuinely WEBP — canvas.toDataURL("image/webp") silently returns a PNG data URL on a browser that can't encode WEBP, rather than throwing. */
export function isWebpDataUrl(dataUrl: string): boolean {
  return dataUrl.toLowerCase().startsWith("data:image/webp");
}

export type TokenArtworkThumbnailEncodeFn = (
  quality: number,
  mimeType: TokenArtworkThumbnailMimeType,
) => string;

/**
 * Picks the smallest-effort thumbnail that fits under the size ceiling:
 * probes WEBP support from the encoder's own output (falling back to JPEG
 * when unsupported), then steps quality down up to twice within that format.
 * Gives up and returns null if the ceiling is still exceeded afterward.
 */
export function pickTokenArtworkThumbnail(encode: TokenArtworkThumbnailEncodeFn): string | null {
  const [firstQuality] = TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS;
  const webpProbe = encode(firstQuality, "image/webp");
  const mimeType: TokenArtworkThumbnailMimeType = isWebpDataUrl(webpProbe) ? "image/webp" : "image/jpeg";

  for (let index = 0; index < TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS.length; index += 1) {
    const quality = TOKEN_ARTWORK_THUMBNAIL_QUALITY_STEPS[index];
    const dataUrl = index === 0 && mimeType === "image/webp" ? webpProbe : encode(quality, mimeType);
    if (decodedByteLength(dataUrl) <= TOKEN_ARTWORK_THUMBNAIL_SIZE_CEILING_BYTES) return dataUrl;
  }

  return null;
}

function loadHeroImageElement(heroImageDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The hero image could not be loaded for thumbnail capture."));
    image.src = heroImageDataUrl;
  });
}

/**
 * Reads `heroImage` (already in memory on the caller's project object),
 * downscales it on a throwaway canvas, and returns the resulting thumbnail
 * data URL — or null when there is no hero image, the browser can't decode
 * it, or the size ceiling can't be met even after stepping quality down.
 * Nothing here is ever stored in React state; the image element, canvas and
 * context are local variables discarded when this function returns.
 */
export async function captureTokenArtworkThumbnail(heroImageDataUrl: string): Promise<string | null> {
  if (!heroImageDataUrl || typeof document === "undefined") return null;

  let image: HTMLImageElement;
  try {
    image = await loadHeroImageElement(heroImageDataUrl);
  } catch {
    return null;
  }

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return null;

  const crop = computeSquareCoverCrop(sourceWidth, sourceHeight);
  const canvasSize = computeThumbnailCanvasSize(crop.size);

  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const encode: TokenArtworkThumbnailEncodeFn = (quality, mimeType) => {
    context.clearRect(0, 0, canvasSize, canvasSize);
    if (mimeType === "image/jpeg") {
      context.fillStyle = "#050706";
      context.fillRect(0, 0, canvasSize, canvasSize);
    }
    context.drawImage(image, crop.sx, crop.sy, crop.size, crop.size, 0, 0, canvasSize, canvasSize);
    return canvas.toDataURL(mimeType, quality);
  };

  try {
    return pickTokenArtworkThumbnail(encode);
  } catch {
    return null;
  }
}
