export type SocialShowcaseSlideId = "voice" | "mascot" | "control";

export type SocialShowcaseSlide = {
  id: SocialShowcaseSlideId;
  step: string;
  title: string;
  body: string;
};

/** The three approved slides for the homepage AI Social Studio showcase (issue #278). */
export const SOCIAL_SHOWCASE_SLIDES: readonly SocialShowcaseSlide[] = [
  {
    id: "voice",
    step: "Step 01",
    title: "Your voice, on autopilot",
    body: "Drop 20 example posts. It learns how you talk. Then it posts like you — 5 times a day, every day.",
  },
  {
    id: "mascot",
    step: "Step 02",
    title: "Your mascot, everywhere",
    body: "Upload your mascot once. Get original artwork with every post — always your character, never anyone else’s.",
  },
  {
    id: "control",
    step: "Step 03",
    title: "You stay in control",
    body: "Approve every post before it goes out, or flip to full autopilot. Your rules, your banned words, your schedule.",
  },
] as const;

export type SocialShowcaseMascotScene = {
  label: string;
  src: string;
};

/** Real artwork lands separately (issue #278); until these files exist the grid renders labelled placeholder frames. */
export const SOCIAL_SHOWCASE_MASCOT_SCENES: readonly SocialShowcaseMascotScene[] = [
  { label: "Beach", src: "/showcase/mascot-beach.png" },
  { label: "Celebrating", src: "/showcase/mascot-celebrating.png" },
  { label: "Trading desk", src: "/showcase/mascot-trading.png" },
  { label: "Space", src: "/showcase/mascot-space.png" },
] as const;

export const SOCIAL_SHOWCASE_CTA_LABEL = "Get started with Pro — $50/month";

export const SOCIAL_SHOWCASE_AUTO_ADVANCE_MS = 6000;

export function nextShowcaseIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return (current + 1) % total;
}

export function clampShowcaseIndex(index: number, total: number): number {
  if (total <= 0) return 0;
  return ((index % total) + total) % total;
}

const SWIPE_THRESHOLD_PX = 40;

/**
 * Positive return advances to the next slide, negative goes back, 0 means the
 * gesture didn't clear the threshold and should be ignored.
 */
export function swipeDeltaToStep(deltaX: number, threshold: number = SWIPE_THRESHOLD_PX): -1 | 0 | 1 {
  if (deltaX <= -threshold) return 1;
  if (deltaX >= threshold) return -1;
  return 0;
}
