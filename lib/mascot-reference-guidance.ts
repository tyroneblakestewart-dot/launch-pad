// "For best results" guidance on the mascot reference upload (owner direction,
// 5 Sep 2026): tell the user what makes a good reference image, and after the
// upload tell them plainly how theirs measures up — but never block. Whatever
// they give us goes to the visual-DNA analysis; these notes only explain why a
// result might be weaker than it could be.

export const MASCOT_REFERENCE_TIPS: readonly string[] = [
  "One character only — no crowd, no second mascot in shot.",
  "Front-facing or three-quarter view, whole body if you have it.",
  "Plain or simple background so the character reads clearly.",
  "Sharp and well lit — at least 1024px on the short side.",
  "Square or close to it works best; we centre-crop the rest.",
  "No text, watermarks or logos stamped over the artwork.",
  "PNG with a transparent background is ideal; JPG and WEBP are fine.",
];

/** The smallest short side we consider a strong reference, and the floor below which detail is genuinely lost. */
export const MASCOT_REFERENCE_IDEAL_MIN_SIDE = 1024;
export const MASCOT_REFERENCE_ROUGH_MIN_SIDE = 512;
/** Beyond this width:height ratio the centre crop starts eating the character. */
export const MASCOT_REFERENCE_MAX_ASPECT_RATIO = 1.6;

export type MascotReferenceVerdict = "great" | "ok" | "rough";

export type MascotReferenceAssessment = {
  verdict: MascotReferenceVerdict;
  /** Plain-English notes the user can act on. Empty when the image is ideal. */
  notes: string[];
  /** One-line summary for the tile. */
  summary: string;
};

/**
 * Judges a reference image from facts we can read client-side, without any
 * AI call. Every note is advice, not a refusal — the caller uploads regardless.
 */
export function assessMascotReference(input: {
  width: number;
  height: number;
  mimeType?: string | null;
}): MascotReferenceAssessment {
  const width = Math.max(0, Math.floor(input.width));
  const height = Math.max(0, Math.floor(input.height));
  const notes: string[] = [];
  let rough = false;
  let ok = false;

  if (width === 0 || height === 0) {
    return {
      verdict: "rough",
      notes: ["We couldn't read the image size — we'll still try, but a clear PNG or JPG works better."],
      summary: "We'll do our best with this one.",
    };
  }

  const shortSide = Math.min(width, height);
  if (shortSide < MASCOT_REFERENCE_ROUGH_MIN_SIDE) {
    rough = true;
    notes.push(`Quite small (${width}×${height}). Fine detail will be lost — ${MASCOT_REFERENCE_IDEAL_MIN_SIDE}px or more on the short side is best.`);
  } else if (shortSide < MASCOT_REFERENCE_IDEAL_MIN_SIDE) {
    ok = true;
    notes.push(`A bit small (${width}×${height}). It'll work; ${MASCOT_REFERENCE_IDEAL_MIN_SIDE}px or more on the short side gives sharper scenes.`);
  }

  const ratio = Math.max(width, height) / shortSide;
  if (ratio > MASCOT_REFERENCE_MAX_ASPECT_RATIO) {
    ok = true;
    notes.push(
      width > height
        ? "Very wide — we'll centre-crop, so make sure the character is in the middle, or crop it square first."
        : "Very tall — we'll centre-crop, so make sure the character is in the middle, or crop it square first.",
    );
  }

  const mime = (input.mimeType ?? "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") {
    notes.push("JPG has no transparency — a PNG with a clear background helps the mascot lift cleanly into new scenes.");
  }

  const verdict: MascotReferenceVerdict = rough ? "rough" : ok || notes.length > 0 ? "ok" : "great";
  const summary =
    verdict === "great"
      ? "Great reference — this should lock in cleanly."
      : verdict === "ok"
        ? "Good enough to work with — a couple of things would make it sharper."
        : "We'll do our best with this one — see the notes for a stronger result.";
  return { verdict, notes, summary };
}
