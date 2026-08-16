// Client-safe types shared between components/social-hub.tsx and the new
// AI Social Studio server routes. Kept separate from lib/server/* so the
// client bundle never pulls in server-only modules.

export type VoiceProfile = {
  tone: string;
  vocabulary: string;
  cadence: string;
  emojiHabits: string;
  sampleLines: [string, string, string];
  exampleCount: number;
  updatedAt: string;
};

/** The mascot's locked visual identity, extracted once from an uploaded reference image. */
export type MascotVisualDNA = {
  characterDescription: string;
  colourPalette: string;
  signatureProps: string;
  artStyle: string;
};

export type SocialDraft = {
  xText: string;
  telegramText: string;
};

/**
 * Feedback on one AI-written Voice preview sample line — "sounds like me"
 * vs "not me" (issue #348). This is purely a style-reinforcement signal,
 * never a publish action: liked lines feed back into future voice-profile
 * and draft generation as capped, secondary reinforcement examples.
 */
export type SampleLineFeedback = {
  text: string;
  sentiment: "liked" | "disliked";
  updatedAt: string;
};

/** Mirrors lib/server/social-connections-store.ts's SocialPlatform without importing a server-only module into the client bundle. */
export type SocialPlatform = "x" | "telegram";

export type QueueItem = {
  id: string;
  xText: string;
  telegramText: string;
  artwork: string | null;
  source: "setup-ai" | "calendar-ai" | "manual" | "auto-replenish";
  dayLabel: string | null;
  createdAt: string;
};

/** Default and cap for issue #352's "always something loaded" Ready-to-review pool size, user-configurable in Settings & Rules. */
export const DEFAULT_QUEUE_TARGET = 5;
export const MAX_QUEUE_TARGET = 20;

/**
 * Posting cadence (issue #358): a single-select pair of daily posting tiers,
 * each hard-capped by the plan entitlement (Pro: 5 posts/day, Pro Bundle:
 * 5 posts/day per token) — `postsPerDayMax` must never exceed
 * MAX_POSTS_PER_DAY, and no third, higher tier should be added.
 */
export type PostingCadence = "conservative" | "active";

export const MAX_POSTS_PER_DAY = 5;

export const POSTING_CADENCE_OPTIONS: Array<{
  id: PostingCadence;
  label: string;
  description: string;
  postsPerDayMax: number;
}> = [
  { id: "conservative", label: "Conservative", description: "1–2 posts per day", postsPerDayMax: 2 },
  { id: "active", label: "Active", description: "3–5 posts per day", postsPerDayMax: 5 },
];

export const DEFAULT_POSTING_CADENCE: PostingCadence = "active";

export type SocialStudioProjectRecord = {
  voiceProfile: VoiceProfile | null;
  voiceExamples: string[];
  mascotVisualDNA: MascotVisualDNA | null;
  mascotReferenceImage: string | null;
  queue: QueueItem[];
  sampleLineFeedback: SampleLineFeedback[];
  queueTarget: number;
  /** Single-select daily posting tier (issue #358) driving queueTarget and the default schedule spread. */
  postingCadence: PostingCadence;
  /** Optional free-text steering for AI drafts (issue #358) — "Tell the AI your focus this week." Empty by default; empty changes nothing about generation. */
  directionBrief: string;
};

export const EMPTY_SOCIAL_STUDIO_RECORD: SocialStudioProjectRecord = {
  voiceProfile: null,
  voiceExamples: [],
  mascotVisualDNA: null,
  mascotReferenceImage: null,
  queue: [],
  sampleLineFeedback: [],
  queueTarget: DEFAULT_QUEUE_TARGET,
  postingCadence: DEFAULT_POSTING_CADENCE,
  directionBrief: "",
};
