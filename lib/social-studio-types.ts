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

export type SocialStudioProjectRecord = {
  voiceProfile: VoiceProfile | null;
  voiceExamples: string[];
  mascotVisualDNA: MascotVisualDNA | null;
  mascotReferenceImage: string | null;
  queue: QueueItem[];
  sampleLineFeedback: SampleLineFeedback[];
  queueTarget: number;
};

export const EMPTY_SOCIAL_STUDIO_RECORD: SocialStudioProjectRecord = {
  voiceProfile: null,
  voiceExamples: [],
  mascotVisualDNA: null,
  mascotReferenceImage: null,
  queue: [],
  sampleLineFeedback: [],
  queueTarget: DEFAULT_QUEUE_TARGET,
};
